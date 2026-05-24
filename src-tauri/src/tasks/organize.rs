//! Per-Task organize loop — folds new Sources into the Task's Wiki.
//!
//! Each Task gets its own dedicated Claude Code session, persisted by
//! `session_id` in `organize-session.json`. Subsequent organize runs
//! resume that session so prompt caching keeps the cost low.
//!
//! Tool gating:
//! - Read / Edit / Write / MultiEdit / Glob / Grep / LS / NotebookEdit
//!   → auto-allow. Claude's cwd is the task's wiki dir, so file mutations
//!   land inside the sandboxed area by default.
//! - Anything else (Bash, WebFetch, Task, ...) → auto-deny with a hint.
//!
//! On `TurnEnd`, the in-flight source ids are stamped with
//! `processed_at_ms` so the next run only ships freshly-captured Sources.

use crate::claude_process::protocol::{
    control_response, control_response_error, user_text_message, PermissionBehavior,
};
use crate::claude_process::spawn::{spawn_claude, ProcessHandle};
use crate::claude_process::stdout_parser::DomainEvent;
use crate::tasks::{
    list_sources, mark_sources_processed, read_organize_session, read_task, wiki_dir,
    write_organize_session, Source, Task,
};
use std::collections::HashSet;
use std::fs;
use std::path::Path;
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Emitter};

/// File-touching tools that are safe to auto-allow during organize.
/// Claude's cwd is the task wiki directory, so these don't escape.
const ALLOWED_TOOLS: &[&str] = &[
    "Read",
    "Edit",
    "Write",
    "MultiEdit",
    "NotebookEdit",
    "Glob",
    "Grep",
    "LS",
];

pub struct OrganizeJob {
    pub process: ProcessHandle,
    pub task_id: String,
    /// Source ids included in the prompt for this run — stamped as
    /// processed on TurnEnd.
    pub source_ids: Vec<String>,
    /// Captured from `session:start` / `session:init` so we can persist
    /// it after TurnEnd for the next run's --resume.
    pub session_id: Arc<Mutex<Option<String>>>,
}

/// Outcome of `prepare_prompt` — broken out so the command layer can
/// distinguish "nothing to do" from genuine errors.
pub struct PreparedRun {
    pub task: Task,
    pub pending: Vec<Source>,
    pub prompt: String,
}

pub fn count_unprocessed_sources(root: &Path, task_id: &str) -> Result<usize, String> {
    let all = list_sources(root, task_id)?;
    Ok(all.iter().filter(|s| s.processed_at_ms.is_none()).count())
}

pub fn prepare_run(root: &Path, task_id: &str) -> Result<Option<PreparedRun>, String> {
    let task = read_task(root, task_id)?;
    let all = list_sources(root, task_id)?;
    let pending: Vec<Source> = all
        .into_iter()
        .filter(|s| s.processed_at_ms.is_none())
        .collect();
    if pending.is_empty() {
        return Ok(None);
    }
    // Ensure the wiki dir exists so Claude can LS / Write without
    // a setup step on the first run.
    let dir = wiki_dir(root, task_id);
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;

    let prompt = build_prompt(&task, &pending);
    Ok(Some(PreparedRun {
        task,
        pending,
        prompt,
    }))
}

fn build_prompt(task: &Task, pending: &[Source]) -> String {
    // Tone: terse Korean, mirrors the rest of the app. We tell Claude
    // *where* it is (cwd = wiki dir), *what* to produce (.md files, no
    // subdirs), and *how* to update vs. create. The Sources go in
    // verbatim — Claude's the one synthesizing them.
    let mut s = String::new();
    s.push_str("# Task 위키 정리\n\n");
    s.push_str(&format!("Task: **{}**\n", task.name));
    if !task.description.trim().is_empty() {
        s.push_str(&format!("\n{}\n", task.description.trim()));
    }
    s.push_str("\n## 작업 지시\n\n");
    s.push_str("- 현재 working directory(cwd)에 이 Task의 위키가 `.md` 파일들로 저장된다.\n");
    s.push_str("- 우선 `LS` 또는 `Glob`으로 기존 위키 파일을 확인하라.\n");
    s.push_str("- 아래 새 Source 들을 읽고, 관련 주제별로 위키 파일에 통합하라.\n");
    s.push_str("  - 기존 파일이 적절하면 `Edit`로 추가/갱신.\n");
    s.push_str("  - 새 주제면 `Write`로 새 `.md` 파일 생성. 파일명은 짧은 영문 슬러그 (예: `decisions.md`, `glossary.md`).\n");
    s.push_str("- **서브디렉터리 금지** — 모든 `.md`는 cwd 바로 아래에 둔다.\n");
    s.push_str("- 위키는 사람이 읽기 위한 정리된 문서다. 원본 Source 텍스트를 그대로 붙여넣지 말고 요약·구조화하라.\n");
    s.push_str("- 변경 후 짧게 어떤 파일을 어떻게 갱신했는지 마지막에 한 줄로 보고하라.\n\n");
    s.push_str(&format!("## 새 Sources ({}개)\n\n", pending.len()));
    for (i, src) in pending.iter().enumerate() {
        let label = if src.title.is_empty() {
            src.kind.clone()
        } else {
            format!("{} · {}", src.title, src.kind)
        };
        s.push_str(&format!("### [{}] {} (id: {})\n", i + 1, label, src.id));
        s.push_str(&src.content);
        s.push_str("\n\n");
    }
    s
}

pub fn dispatch_event(
    app: &AppHandle,
    job_handle: Arc<Mutex<Option<OrganizeJob>>>,
    tasks_root: std::path::PathBuf,
    bindings_root: std::path::PathBuf,
    task_id: String,
    ev: DomainEvent,
) {
    let _ = bindings_root; // reserved for future cross-binding refresh hints
    let with_task = |v: serde_json::Value| -> serde_json::Value {
        let mut v = v;
        if let Some(obj) = v.as_object_mut() {
            obj.insert(
                "task_id".to_string(),
                serde_json::Value::String(task_id.clone()),
            );
        }
        v
    };
    match ev {
        DomainEvent::SessionStart { session_id } => {
            if let Ok(guard) = job_handle.lock() {
                if let Some(job) = guard.as_ref() {
                    if let Ok(mut sid) = job.session_id.lock() {
                        *sid = Some(session_id.clone());
                    }
                }
            }
            let _ = app.emit(
                "organize:session_start",
                with_task(serde_json::json!({ "session_id": session_id })),
            );
        }
        DomainEvent::SessionInit { session_id, .. } => {
            if let (Some(sid_str), Ok(guard)) = (session_id.clone(), job_handle.lock()) {
                if let Some(job) = guard.as_ref() {
                    if let Ok(mut sid) = job.session_id.lock() {
                        *sid = Some(sid_str);
                    }
                }
            }
            let _ = app.emit(
                "organize:session_init",
                with_task(serde_json::json!({ "session_id": session_id })),
            );
        }
        DomainEvent::Message { kind, body, .. } if kind == "assistant" => {
            let _ = app.emit(
                "organize:assistant",
                with_task(serde_json::json!({ "body": body })),
            );
        }
        DomainEvent::ToolRequest {
            request_id,
            tool_name,
            input,
            tool_use_id,
            ..
        } => {
            let allowed = ALLOWED_TOOLS.contains(&tool_name.as_str());
            let _ = app.emit(
                "organize:tool",
                with_task(serde_json::json!({
                    "tool": tool_name,
                    "allowed": allowed,
                    "input": input,
                })),
            );
            if let Ok(guard) = job_handle.lock() {
                if let Some(job) = guard.as_ref() {
                    let tx = job.process.stdin_tx.clone();
                    let msg = if allowed {
                        control_response(
                            request_id,
                            PermissionBehavior::Allow,
                            tool_use_id,
                            None,
                            None,
                        )
                    } else {
                        control_response(
                            request_id,
                            PermissionBehavior::Deny,
                            tool_use_id,
                            None,
                            Some(format!(
                                "organize 세션은 파일 편집 계열 툴만 허용합니다. \"{tool_name}\"은(는) 거부되었습니다."
                            )),
                        )
                    };
                    tokio::spawn(async move {
                        let _ = tx.send(msg).await;
                    });
                }
            }
        }
        DomainEvent::UnsupportedControlRequest { request_id, .. } => {
            if let Ok(guard) = job_handle.lock() {
                if let Some(job) = guard.as_ref() {
                    let tx = job.process.stdin_tx.clone();
                    let msg = control_response_error(
                        request_id,
                        "organize session does not handle control_requests".into(),
                    );
                    tokio::spawn(async move {
                        let _ = tx.send(msg).await;
                    });
                }
            }
        }
        DomainEvent::TurnEnd { .. } => {
            // 1) snapshot the sources we sent + the captured session id,
            // 2) drop the slot (this run is done),
            // 3) persist session id + mark sources processed,
            // 4) tell the UI to refresh its wiki/sources view.
            let (source_ids, captured_session) = if let Ok(mut guard) = job_handle.lock() {
                if let Some(mut job) = guard.take() {
                    let sid = job
                        .session_id
                        .lock()
                        .ok()
                        .and_then(|s| s.clone());
                    let ids = std::mem::take(&mut job.source_ids);
                    job.process.kill();
                    (ids, sid)
                } else {
                    (Vec::new(), None)
                }
            } else {
                (Vec::new(), None)
            };
            if let Some(sid) = captured_session {
                let _ = write_organize_session(&tasks_root, &task_id, &sid);
            }
            let processed_set: HashSet<String> = source_ids.iter().cloned().collect();
            let _ = mark_sources_processed(&tasks_root, &task_id, &source_ids);
            let _ = app.emit(
                "organize:done",
                with_task(serde_json::json!({
                    "processed_source_ids": processed_set.into_iter().collect::<Vec<_>>(),
                })),
            );
        }
        _ => {}
    }
}

/// Compose the kickoff stdin message — exposed for callers that need it
/// after `spawn_claude` succeeds.
pub fn kickoff_message(prompt: String) -> crate::claude_process::protocol::StdinMessage {
    user_text_message(prompt)
}

/// Spawn the organize child process. Returns the handle + the
/// `session_id` slot the dispatch loop populates on `session:start`.
#[allow(clippy::too_many_arguments)]
pub async fn spawn_organize_process(
    app: AppHandle,
    claude_bin: String,
    tasks_root: std::path::PathBuf,
    bindings_root: std::path::PathBuf,
    task_id: String,
    resume_session: Option<String>,
    job_slot: Arc<Mutex<Option<OrganizeJob>>>,
) -> Result<ProcessHandle, String> {
    let cwd = wiki_dir(&tasks_root, &task_id);
    fs::create_dir_all(&cwd).map_err(|e| e.to_string())?;
    let cwd_str = cwd.to_string_lossy().to_string();

    let app_ev = app.clone();
    let app_err = app.clone();
    let app_exit = app.clone();
    let job_ev = job_slot.clone();
    let job_exit = job_slot.clone();
    let task_for_ev = task_id.clone();
    let task_for_err = task_id.clone();
    let task_for_exit = task_id.clone();
    let tasks_for_ev = tasks_root.clone();
    let bindings_for_ev = bindings_root.clone();

    spawn_claude(
        &claude_bin,
        &cwd_str,
        resume_session.as_deref(),
        move |ev| {
            dispatch_event(
                &app_ev,
                job_ev.clone(),
                tasks_for_ev.clone(),
                bindings_for_ev.clone(),
                task_for_ev.clone(),
                ev,
            );
        },
        move |line| {
            eprintln!("[organize stderr {task_for_err}] {line}");
            let _ = app_err.emit(
                "organize:stderr",
                serde_json::json!({ "task_id": task_for_err, "line": line }),
            );
        },
        move |_exited_id| {
            // If the slot is still occupied at exit, the process died
            // before TurnEnd cleaned up — clear it so the next click
            // doesn't see a stale "already running" state.
            if let Ok(mut guard) = job_exit.lock() {
                if guard.is_some() {
                    *guard = None;
                }
            }
            let _ = app_exit.emit(
                "organize:exit",
                serde_json::json!({ "task_id": task_for_exit }),
            );
        },
    )
    .await
}

#[allow(dead_code)]
pub fn read_session_for_task(root: &Path, task_id: &str) -> Option<String> {
    read_organize_session(root, task_id)
        .ok()
        .flatten()
        .map(|m| m.session_id)
}
