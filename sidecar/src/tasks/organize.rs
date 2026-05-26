//! Per-Task organize loop — folds new Sources into the Task's Wiki (ported from
//! the Tauri lib, tauri-free). Each Task gets a dedicated, resumable Claude
//! session; AppState's organize-job registry becomes `state::organize_jobs()`
//! and `AppHandle.emit` becomes `emit_event`.

use crate::bridge::emit_event;
use crate::claude_process::protocol::{
    control_response, control_response_error, user_text_message, PermissionBehavior, StdinMessage,
};
use crate::claude_process::spawn::{spawn_claude, ProcessHandle};
use crate::claude_process::stdout_parser::DomainEvent;
use crate::tasks::{
    list_sources, mark_sources_processed, read_organize_session, read_task, wiki_dir,
    write_organize_session, Source, Task,
};
use serde::Serialize;
use serde_json::json;
use std::collections::HashSet;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};

/// File-touching tools safe to auto-allow during organize (cwd = wiki dir).
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
    pub source_ids: Vec<String>,
    pub session_id: Arc<Mutex<Option<String>>>,
}

/// Per-task organize slot: `Some` while a run is in flight.
pub type OrganizeSlot = Arc<Mutex<Option<OrganizeJob>>>;

pub struct PreparedRun {
    pub task: Task,
    pub pending: Vec<Source>,
    pub prompt: String,
}

#[derive(Serialize)]
pub struct OrganizePreview {
    pub task_id: String,
    pub unprocessed_count: u64,
    pub resume_session_id: Option<String>,
}

fn count_unprocessed_sources(root: &Path, task_id: &str) -> Result<usize, String> {
    let all = list_sources(root, task_id)?;
    Ok(all.iter().filter(|s| s.processed_at_ms.is_none()).count())
}

pub fn prepare_run(root: &Path, task_id: &str) -> Result<Option<PreparedRun>, String> {
    let task = read_task(root, task_id)?;
    let all = list_sources(root, task_id)?;
    let pending: Vec<Source> = all.into_iter().filter(|s| s.processed_at_ms.is_none()).collect();
    if pending.is_empty() {
        return Ok(None);
    }
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

fn dispatch_event(job_handle: OrganizeSlot, tasks_root: PathBuf, task_id: String, ev: DomainEvent) {
    let with_task = |mut v: serde_json::Value| -> serde_json::Value {
        if let Some(obj) = v.as_object_mut() {
            obj.insert("task_id".to_string(), serde_json::Value::String(task_id.clone()));
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
            emit_event("organize:session_start", with_task(json!({ "session_id": session_id })));
        }
        DomainEvent::SessionInit { session_id, .. } => {
            if let (Some(sid_str), Ok(guard)) = (session_id.clone(), job_handle.lock()) {
                if let Some(job) = guard.as_ref() {
                    if let Ok(mut sid) = job.session_id.lock() {
                        *sid = Some(sid_str);
                    }
                }
            }
            emit_event("organize:session_init", with_task(json!({ "session_id": session_id })));
        }
        DomainEvent::Message { kind, body, .. } if kind == "assistant" => {
            emit_event("organize:assistant", with_task(json!({ "body": body })));
        }
        DomainEvent::ToolRequest {
            request_id,
            tool_name,
            input,
            tool_use_id,
            ..
        } => {
            let allowed = ALLOWED_TOOLS.contains(&tool_name.as_str());
            emit_event(
                "organize:tool",
                with_task(json!({ "tool": tool_name, "allowed": allowed, "input": input })),
            );
            if let Ok(guard) = job_handle.lock() {
                if let Some(job) = guard.as_ref() {
                    let tx = job.process.stdin_tx.clone();
                    let msg = if allowed {
                        control_response(request_id, PermissionBehavior::Allow, tool_use_id, None, None)
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
            let (source_ids, captured_session) = if let Ok(mut guard) = job_handle.lock() {
                if let Some(mut job) = guard.take() {
                    let sid = job.session_id.lock().ok().and_then(|s| s.clone());
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
            emit_event(
                "organize:done",
                with_task(json!({
                    "processed_source_ids": processed_set.into_iter().collect::<Vec<_>>(),
                })),
            );
        }
        _ => {}
    }
}

pub fn kickoff_message(prompt: String) -> StdinMessage {
    user_text_message(prompt)
}

async fn spawn_organize_process(
    claude_bin: String,
    tasks_root: PathBuf,
    task_id: String,
    resume_session: Option<String>,
    job_slot: OrganizeSlot,
) -> Result<ProcessHandle, String> {
    let cwd = wiki_dir(&tasks_root, &task_id);
    fs::create_dir_all(&cwd).map_err(|e| e.to_string())?;
    let cwd_str = cwd.to_string_lossy().to_string();

    let job_ev = job_slot.clone();
    let job_exit = job_slot;
    let task_for_ev = task_id.clone();
    let task_for_err = task_id.clone();
    let task_for_exit = task_id;
    let tasks_for_ev = tasks_root;

    spawn_claude(
        &claude_bin,
        &cwd_str,
        resume_session.as_deref(),
        move |ev| dispatch_event(job_ev.clone(), tasks_for_ev.clone(), task_for_ev.clone(), ev),
        move |line| {
            eprintln!("[organize stderr {task_for_err}] {line}");
            emit_event("organize:stderr", json!({ "task_id": task_for_err, "line": line }));
        },
        move |_exited_id| {
            if let Ok(mut guard) = job_exit.lock() {
                if guard.is_some() {
                    *guard = None;
                }
            }
            emit_event("organize:exit", json!({ "task_id": task_for_exit }));
        },
    )
    .await
}

// ── command layer ──────────────────────────────────────────────────────────

pub fn get_organize_preview(task_id: String) -> Result<OrganizePreview, String> {
    let root = crate::tasks::default_tasks_root();
    let count = count_unprocessed_sources(&root, &task_id)? as u64;
    let resume = read_organize_session(&root, &task_id)
        .ok()
        .flatten()
        .map(|m| m.session_id);
    Ok(OrganizePreview {
        task_id,
        unprocessed_count: count,
        resume_session_id: resume,
    })
}

/// Core of `start_task_organize`; also chained by the distill pipeline.
pub async fn run_organize(task_id: String) -> Result<(), String> {
    let tasks_root = crate::tasks::default_tasks_root();

    let slot: OrganizeSlot = {
        let mut jobs = crate::state::organize_jobs().lock().map_err(|e| e.to_string())?;
        let s = jobs
            .entry(task_id.clone())
            .or_insert_with(|| Arc::new(Mutex::new(None)))
            .clone();
        let guard = s.lock().map_err(|e| e.to_string())?;
        if guard.is_some() {
            return Err("이 Task의 organize 작업이 이미 실행 중입니다.".into());
        }
        drop(guard);
        s
    };

    let prepared = match prepare_run(&tasks_root, &task_id)? {
        Some(p) => p,
        None => return Err("정리할 새 Source가 없습니다.".into()),
    };

    let claude_bin = crate::state::get_config()?
        .claude_path
        .filter(|s| !s.trim().is_empty())
        .ok_or_else(|| "claude_path가 설정되지 않았습니다.".to_string())?;

    let resume_session = read_organize_session(&tasks_root, &task_id)
        .ok()
        .flatten()
        .map(|m| m.session_id);

    let source_ids: Vec<String> = prepared.pending.iter().map(|s| s.id.clone()).collect();

    emit_event(
        "organize:start",
        json!({ "task_id": task_id, "source_count": source_ids.len() }),
    );

    let handle = spawn_organize_process(
        claude_bin,
        tasks_root,
        task_id.clone(),
        resume_session,
        slot.clone(),
    )
    .await?;
    let tx = handle.stdin_tx.clone();

    {
        let mut guard = slot.lock().map_err(|e| e.to_string())?;
        *guard = Some(OrganizeJob {
            process: handle,
            task_id: task_id.clone(),
            source_ids,
            session_id: Arc::new(Mutex::new(None)),
        });
    }

    tx.send(kickoff_message(prepared.prompt)).await.map_err(|e| e.to_string())?;
    Ok(())
}

pub fn cancel_task_organize(task_id: String) -> Result<(), String> {
    let slot = {
        let jobs = crate::state::organize_jobs().lock().map_err(|e| e.to_string())?;
        jobs.get(&task_id).cloned()
    };
    if let Some(slot) = slot {
        let mut guard = slot.lock().map_err(|e| e.to_string())?;
        if let Some(mut job) = guard.take() {
            job.process.kill();
        }
    }
    emit_event("organize:cancelled", json!({ "task_id": task_id }));
    Ok(())
}
