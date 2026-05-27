//! Session → Source distillation (ported from the Tauri lib, tauri-free).
//!
//! A one-shot Claude pass reads a chat session transcript and extracts durable
//! knowledge as curated Sources, which are persisted via `create_source`, after
//! which the organize loop is kicked to fold them into the Wiki. AppState's
//! harvest registry becomes `state::harvest_jobs()`; `AppHandle.emit` becomes
//! `emit_event`; the organize chain calls `super::organize::run_organize`.

use crate::bridge::emit_event;
use crate::claude_process::protocol::{
    control_response, control_response_error, user_text_message, PermissionBehavior,
};
use crate::claude_process::spawn::{spawn_claude, ProcessHandle};
use crate::claude_process::stdout_parser::DomainEvent;
use crate::history::load_recent::{extract_qa_pairs, AssistantSegment, QaPair};
use crate::tasks::{
    create_source, list_sources, list_wiki_files, read_task, source_title, wiki_dir, SourceOrigin,
    Task,
};
use serde::Deserialize;
use serde_json::{json, Value};
use std::path::PathBuf;
use std::sync::{Arc, Mutex};

const TRANSCRIPT_BUDGET: usize = 60_000;
const SEGMENT_LIMIT: usize = 4_000;

pub const SESSION_SOURCE_KIND: &str = "session";

pub struct DistillJob {
    pub process: ProcessHandle,
    pub task_id: String,
    pub origin_session_id: String,
    pub project_path: String,
    pub collected: Arc<Mutex<String>>,
}

/// Per-task harvest slot: `Some` while a distill run is in flight.
pub type HarvestSlot = Arc<Mutex<Option<DistillJob>>>;

#[derive(Deserialize)]
pub struct HarvestArgs {
    pub task_id: String,
    pub session_id: String,
    pub project_path: String,
}

#[derive(Debug, Deserialize)]
pub struct DistilledSource {
    #[serde(default)]
    pub title: String,
    pub content: String,
}

fn truncate(s: &str, limit: usize) -> String {
    if s.chars().count() <= limit {
        return s.to_string();
    }
    let head: String = s.chars().take(limit).collect();
    format!("{head}…")
}

fn render_pair(p: &QaPair) -> String {
    let mut out = String::new();
    let q = p.user_text.trim();
    if !q.is_empty() {
        out.push_str("### 사용자\n");
        out.push_str(&truncate(q, SEGMENT_LIMIT));
        out.push('\n');
    }
    let mut lines: Vec<String> = Vec::new();
    for seg in &p.segments {
        match seg {
            AssistantSegment::Text { text } => {
                let t = text.trim();
                if !t.is_empty() {
                    lines.push(truncate(t, SEGMENT_LIMIT));
                }
            }
            AssistantSegment::Plan { text } => {
                let t = text.trim();
                if !t.is_empty() {
                    lines.push(format!("[계획]\n{}", truncate(t, SEGMENT_LIMIT)));
                }
            }
            AssistantSegment::ToolUse { name, summary, .. } => {
                if summary.trim().is_empty() {
                    lines.push(format!("`{name}`"));
                } else {
                    lines.push(format!("`{name}: {summary}`"));
                }
            }
            _ => {}
        }
    }
    if !lines.is_empty() {
        out.push_str("### 어시스턴트\n");
        out.push_str(&lines.join("\n"));
        out.push('\n');
    }
    out
}

pub fn render_transcript(pairs: &[QaPair]) -> String {
    let mut blocks: Vec<String> = Vec::new();
    let mut total = 0usize;
    for pair in pairs.iter().rev() {
        let block = render_pair(pair);
        if block.trim().is_empty() {
            continue;
        }
        total += block.len();
        blocks.push(block);
        if total > TRANSCRIPT_BUDGET {
            break;
        }
    }
    blocks.reverse();
    blocks.join("\n")
}

pub fn build_prompt(
    task: &Task,
    existing_source_labels: &[String],
    wiki_names: &[String],
    transcript: &str,
) -> String {
    let mut s = String::new();
    s.push_str("# 세션 → Source 추출\n\n");
    s.push_str(&format!("Task: **{}**\n", task.name));
    if !task.description.trim().is_empty() {
        s.push_str(&format!("\n{}\n", task.description.trim()));
    }
    s.push_str("\n## 지시\n\n");
    s.push_str("아래는 한 작업 세션의 대화 기록이다. 이 대화에서 **오래 보관할 가치가 있는 지식**만 골라 구조화된 Source 목록으로 추출하라.\n\n");
    s.push_str("- 추출 대상: 내려진 결정과 그 근거, 확정된 사실·제약, 함정(gotcha), 규약·컨벤션, 중요한 코드 위치나 아키텍처 설명.\n");
    s.push_str("- 제외 대상: 일시적인 잡담, 단순 진행 보고, 추출할 가치가 없는 시행착오, 아래 \"이미 수집된 항목\"에 이미 담긴 내용.\n");
    s.push_str("- 각 Source는 대화 맥락 없이도 그 자체로 이해되는 자족적인 마크다운이어야 한다.\n");
    s.push_str("- 보관할 게 없으면 빈 배열을 출력하라. 억지로 만들지 마라.\n\n");

    if !existing_source_labels.is_empty() || !wiki_names.is_empty() {
        s.push_str("## 이미 수집된 항목 (중복 금지)\n\n");
        for label in existing_source_labels {
            s.push_str(&format!("- {label}\n"));
        }
        for name in wiki_names {
            s.push_str(&format!("- (위키) {name}\n"));
        }
        s.push('\n');
    }

    s.push_str("## 대화 기록\n\n");
    s.push_str(transcript);
    s.push_str("\n\n## 출력 형식\n\n");
    s.push_str("오직 아래 형식의 JSON 배열 하나만 출력하라. 코드펜스(```json) 안에 넣고, 그 밖의 설명 문장은 쓰지 마라.\n\n");
    s.push_str("```json\n");
    s.push_str("[\n  { \"title\": \"짧은 한 줄 제목\", \"content\": \"자족적 마크다운 본문\" }\n]\n");
    s.push_str("```\n");
    s
}

fn append_assistant_text(buf: &mut String, body: &Value) {
    let content = body.get("content");
    if let Some(s) = content.and_then(|c| c.as_str()) {
        buf.push_str(s);
        return;
    }
    let Some(arr) = content.and_then(|c| c.as_array()) else {
        return;
    };
    for item in arr {
        if item.get("type").and_then(|t| t.as_str()) == Some("text") {
            if let Some(t) = item.get("text").and_then(|t| t.as_str()) {
                buf.push_str(t);
                buf.push('\n');
            }
        }
    }
}

fn extract_json_array(text: &str) -> String {
    if let Some(start) = text.find("```json") {
        let after = &text[start + "```json".len()..];
        if let Some(end) = after.find("```") {
            return after[..end].trim().to_string();
        }
    }
    if let Some(start) = text.find("```") {
        let after = &text[start + 3..];
        if let Some(end) = after.find("```") {
            let inner = after[..end].trim();
            if inner.starts_with('[') {
                return inner.to_string();
            }
        }
    }
    if let (Some(open), Some(close)) = (text.find('['), text.rfind(']')) {
        if close > open {
            return text[open..=close].to_string();
        }
    }
    String::new()
}

pub fn parse_distilled_sources(text: &str) -> Vec<DistilledSource> {
    let slice = extract_json_array(text);
    if slice.is_empty() {
        return Vec::new();
    }
    serde_json::from_str::<Vec<DistilledSource>>(&slice)
        .unwrap_or_default()
        .into_iter()
        .filter(|s| !s.content.trim().is_empty())
        .collect()
}

fn dispatch_event(job_handle: HarvestSlot, tasks_root: PathBuf, task_id: String, ev: DomainEvent) {
    let with_task = |mut v: Value| -> Value {
        if let Some(obj) = v.as_object_mut() {
            obj.insert("task_id".to_string(), Value::String(task_id.clone()));
        }
        v
    };
    match ev {
        DomainEvent::Message { kind, body, .. } if kind == "assistant" => {
            if let Ok(guard) = job_handle.lock() {
                if let Some(job) = guard.as_ref() {
                    if let Ok(mut buf) = job.collected.lock() {
                        append_assistant_text(&mut buf, &body);
                    }
                }
            }
            emit_event("harvest:assistant", with_task(json!({})));
        }
        DomainEvent::ToolRequest {
            request_id,
            tool_name,
            tool_use_id,
            ..
        } => {
            if let Ok(guard) = job_handle.lock() {
                if let Some(job) = guard.as_ref() {
                    let tx = job.process.stdin_tx.clone();
                    let msg = control_response(
                        request_id,
                        PermissionBehavior::Deny,
                        tool_use_id,
                        None,
                        Some(format!(
                            "세션 수집은 텍스트만 출력합니다. \"{tool_name}\"은(는) 거부되었습니다."
                        )),
                    );
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
                        "distill session does not handle control_requests".into(),
                    );
                    tokio::spawn(async move {
                        let _ = tx.send(msg).await;
                    });
                }
            }
        }
        DomainEvent::TurnEnd { .. } => {
            let (collected, origin_session, project_path) = if let Ok(mut guard) = job_handle.lock() {
                if let Some(mut job) = guard.take() {
                    let text = job.collected.lock().ok().map(|t| t.clone()).unwrap_or_default();
                    let os = job.origin_session_id.clone();
                    let pp = job.project_path.clone();
                    job.process.kill();
                    (text, os, pp)
                } else {
                    (String::new(), String::new(), String::new())
                }
            } else {
                (String::new(), String::new(), String::new())
            };

            let distilled = parse_distilled_sources(&collected);
            let origin = SourceOrigin {
                session_id: (!origin_session.is_empty()).then_some(origin_session),
                qa_id: None,
                project_path: (!project_path.is_empty()).then_some(project_path),
            };
            let mut created = 0usize;
            for d in &distilled {
                if create_source(
                    &tasks_root,
                    &task_id,
                    SESSION_SOURCE_KIND.to_string(),
                    d.title.clone(),
                    d.content.clone(),
                    origin.clone(),
                )
                .is_ok()
                {
                    created += 1;
                }
            }
            emit_event("harvest:done", with_task(json!({ "source_count": created })));
            if created > 0 {
                let tid = task_id.clone();
                tokio::spawn(async move {
                    if let Err(e) = super::organize::run_organize(tid.clone()).await {
                        emit_event("harvest:error", json!({ "task_id": tid, "error": e }));
                    }
                });
            }
        }
        _ => {}
    }
}

async fn spawn_distill_process(
    claude_bin: String,
    tasks_root: PathBuf,
    task_id: String,
    job_slot: HarvestSlot,
) -> Result<ProcessHandle, String> {
    let cwd = wiki_dir(&tasks_root, &task_id);
    std::fs::create_dir_all(&cwd).map_err(|e| e.to_string())?;
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
        None,
        move |ev| dispatch_event(job_ev.clone(), tasks_for_ev.clone(), task_for_ev.clone(), ev),
        move |line| {
            eprintln!("[distill stderr {task_for_err}] {line}");
            emit_event("harvest:stderr", json!({ "task_id": task_for_err, "line": line }));
        },
        move |_exited_id| {
            if let Ok(mut guard) = job_exit.lock() {
                if guard.is_some() {
                    *guard = None;
                }
            }
            emit_event("harvest:exit", json!({ "task_id": task_for_exit }));
        },
    )
    .await
}

// ── command layer ──────────────────────────────────────────────────────────

pub async fn start_session_harvest(args: HarvestArgs) -> Result<(), String> {
    let HarvestArgs {
        task_id,
        session_id,
        project_path,
    } = args;
    if session_id.trim().is_empty() {
        return Err("활성 세션이 없습니다.".into());
    }
    let tasks_root = crate::tasks::default_tasks_root();

    let slot: HarvestSlot = {
        let mut jobs = crate::state::harvest_jobs().lock().map_err(|e| e.to_string())?;
        let s = jobs
            .entry(task_id.clone())
            .or_insert_with(|| Arc::new(Mutex::new(None)))
            .clone();
        let guard = s.lock().map_err(|e| e.to_string())?;
        if guard.is_some() {
            return Err("이 Task의 세션 수집이 이미 실행 중입니다.".into());
        }
        drop(guard);
        s
    };

    let dir = crate::history::load_recent::projects_dir_for(&project_path).unwrap_or_default();
    let file = dir.join(format!("{session_id}.jsonl"));
    if !file.exists() {
        return Err("세션 기록을 찾을 수 없습니다.".into());
    }
    let pairs = extract_qa_pairs(&file);
    if pairs.is_empty() {
        return Err("수집할 세션 내용이 없습니다.".into());
    }

    let task = read_task(&tasks_root, &task_id)?;
    let existing_labels: Vec<String> = list_sources(&tasks_root, &task_id)
        .unwrap_or_default()
        .iter()
        .map(source_title)
        .collect();
    let wiki_names: Vec<String> = list_wiki_files(&tasks_root, &task_id)
        .unwrap_or_default()
        .into_iter()
        .map(|w| w.name)
        .collect();
    let transcript = render_transcript(&pairs);
    let prompt = build_prompt(&task, &existing_labels, &wiki_names, &transcript);

    let claude_bin = crate::state::get_config()?
        .claude_path
        .filter(|s| !s.trim().is_empty())
        .ok_or_else(|| "claude_path가 설정되지 않았습니다.".to_string())?;

    emit_event(
        "harvest:start",
        json!({ "task_id": task_id, "pair_count": pairs.len() }),
    );

    let handle = spawn_distill_process(claude_bin, tasks_root, task_id.clone(), slot.clone()).await?;
    let tx = handle.stdin_tx.clone();

    {
        let mut guard = slot.lock().map_err(|e| e.to_string())?;
        *guard = Some(DistillJob {
            process: handle,
            task_id: task_id.clone(),
            origin_session_id: session_id,
            project_path,
            collected: Arc::new(Mutex::new(String::new())),
        });
    }

    tx.send(user_text_message(prompt)).await.map_err(|e| e.to_string())?;
    Ok(())
}

pub fn cancel_session_harvest(task_id: String) -> Result<(), String> {
    let slot = {
        let jobs = crate::state::harvest_jobs().lock().map_err(|e| e.to_string())?;
        jobs.get(&task_id).cloned()
    };
    if let Some(slot) = slot {
        let mut guard = slot.lock().map_err(|e| e.to_string())?;
        if let Some(mut job) = guard.take() {
            job.process.kill();
        }
    }
    emit_event("harvest:cancelled", json!({ "task_id": task_id }));
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::history::load_recent::AssistantSegment;

    fn pair(user: &str, segs: Vec<AssistantSegment>) -> QaPair {
        QaPair {
            id: "id".into(),
            user_text: user.into(),
            segments: segs,
            timestamp: "t".into(),
        }
    }

    #[test]
    fn parses_fenced_json_array() {
        let text = "여기 결과입니다:\n```json\n[{\"title\":\"인증\",\"content\":\"JWT 사용\"}]\n```\n끝.";
        let out = parse_distilled_sources(text);
        assert_eq!(out.len(), 1);
        assert_eq!(out[0].title, "인증");
        assert_eq!(out[0].content, "JWT 사용");
    }

    #[test]
    fn parses_bare_array_without_fence() {
        let text = "[{\"content\":\"내용만 있는 소스\"}]";
        let out = parse_distilled_sources(text);
        assert_eq!(out.len(), 1);
        assert_eq!(out[0].title, "");
        assert_eq!(out[0].content, "내용만 있는 소스");
    }

    #[test]
    fn drops_empty_content_entries() {
        let text = "```json\n[{\"title\":\"a\",\"content\":\"\"},{\"title\":\"b\",\"content\":\"keep\"}]\n```";
        let out = parse_distilled_sources(text);
        assert_eq!(out.len(), 1);
        assert_eq!(out[0].content, "keep");
    }

    #[test]
    fn empty_array_yields_nothing() {
        assert!(parse_distilled_sources("```json\n[]\n```").is_empty());
        assert!(parse_distilled_sources("추출할 내용이 없습니다.").is_empty());
        assert!(parse_distilled_sources("not json at all").is_empty());
    }

    #[test]
    fn malformed_json_is_swallowed() {
        let out = parse_distilled_sources("[{\"content\": \"oops\", }]  trailing");
        assert!(out.is_empty());
    }

    #[test]
    fn transcript_renders_user_and_assistant() {
        let pairs = vec![pair(
            "인증 방식?",
            vec![
                AssistantSegment::Text { text: "JWT를 씁니다".into() },
                AssistantSegment::ToolUse {
                    id: "1".into(),
                    name: "Read".into(),
                    summary: "/auth.rs".into(),
                    input: serde_json::Value::Null,
                },
            ],
        )];
        let t = render_transcript(&pairs);
        assert!(t.contains("### 사용자"));
        assert!(t.contains("인증 방식?"));
        assert!(t.contains("### 어시스턴트"));
        assert!(t.contains("JWT를 씁니다"));
        assert!(t.contains("`Read: /auth.rs`"));
    }

    #[test]
    fn transcript_skips_thinking_and_results() {
        let pairs = vec![pair(
            "q",
            vec![
                AssistantSegment::Thinking { text: "secret reasoning".into() },
                AssistantSegment::Text { text: "answer".into() },
            ],
        )];
        let t = render_transcript(&pairs);
        assert!(!t.contains("secret reasoning"));
        assert!(t.contains("answer"));
    }
}
