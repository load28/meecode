//! Session → Source distillation.
//!
//! Where `organize` folds raw Sources into the Wiki, `distill` runs one step
//! earlier: a one-shot Claude pass reads a chat session's transcript and
//! extracts the durable knowledge worth keeping as a curated set of Sources.
//! Those Sources are persisted via the normal `create_source` path (so the
//! schema stays owned by Rust), then the organize loop is kicked automatically
//! to fold them into the Wiki — giving a single "session → sources → wiki"
//! action.
//!
//! The distill process needs no file tools: we hand it the transcript in the
//! prompt and ask for a JSON array back. Any tool the model tries is denied.
//! On `TurnEnd` the collected assistant text is parsed, Sources are written,
//! and `commands::run_organize` is spawned to continue the pipeline.

use crate::claude_process::protocol::{
    control_response, control_response_error, PermissionBehavior,
};
use crate::claude_process::spawn::{spawn_claude, ProcessHandle};
use crate::claude_process::stdout_parser::DomainEvent;
use crate::history::load_recent::{AssistantSegment, QaPair};
use crate::tasks::{create_source, wiki_dir, SourceOrigin, Task};
use serde::Deserialize;
use serde_json::{json, Value};
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Emitter};

/// Upper bound on the rendered transcript so a very long session can't blow
/// past the model's context. We keep the *most recent* turns when over budget
/// — the tail of a session is where conclusions usually land.
const TRANSCRIPT_BUDGET: usize = 60_000;
/// Per-segment clamp so one enormous tool dump / answer doesn't crowd out the
/// rest of the conversation.
const SEGMENT_LIMIT: usize = 4_000;

/// `kind` stamped on Sources produced by distillation — distinguishes them
/// from hand-captured `qa_block` / `selection` / `manual` Sources.
pub const SESSION_SOURCE_KIND: &str = "session";

pub struct DistillJob {
    pub process: ProcessHandle,
    pub task_id: String,
    /// The session being harvested (recorded as `origin.session_id` on each
    /// produced Source). This is *not* the distill Claude process's own id.
    pub origin_session_id: String,
    pub project_path: String,
    /// Assistant text accumulated across the turn; parsed for the JSON array
    /// on `TurnEnd`.
    pub collected: Arc<Mutex<String>>,
}

/// One extracted Source as emitted by the distill model.
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
            // Thinking, tool results, images, and redacted blocks are noise for
            // distillation — drop them so the budget goes to real content.
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

/// Render the QA pairs as a readable markdown transcript, newest turns kept
/// first when over budget but emitted in chronological order.
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

/// Pull the assistant `text` blocks out of an assistant message `body` and
/// append them to the running buffer.
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

/// Best-effort extraction of the JSON array from the model's reply. Prefers a
/// ```json fenced block; falls back to the first `[` … last `]` slice.
fn extract_json_array(text: &str) -> String {
    // 1) fenced ```json ... ```
    if let Some(start) = text.find("```json") {
        let after = &text[start + "```json".len()..];
        if let Some(end) = after.find("```") {
            return after[..end].trim().to_string();
        }
    }
    // 2) generic fence ``` ... ```
    if let Some(start) = text.find("```") {
        let after = &text[start + 3..];
        if let Some(end) = after.find("```") {
            let inner = after[..end].trim();
            if inner.starts_with('[') {
                return inner.to_string();
            }
        }
    }
    // 3) first '[' to last ']'
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

pub fn dispatch_event(
    app: &AppHandle,
    job_handle: Arc<Mutex<Option<DistillJob>>>,
    tasks_root: PathBuf,
    task_id: String,
    ev: DomainEvent,
) {
    let with_task = |v: Value| -> Value {
        let mut v = v;
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
            let _ = app.emit("harvest:assistant", with_task(json!({})));
        }
        DomainEvent::ToolRequest {
            request_id,
            tool_name,
            tool_use_id,
            ..
        } => {
            // Distillation is pure text-in/text-out — deny every tool.
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
            let (collected, origin_session, project_path) = if let Ok(mut guard) = job_handle.lock()
            {
                if let Some(mut job) = guard.take() {
                    let text = job
                        .collected
                        .lock()
                        .ok()
                        .map(|t| t.clone())
                        .unwrap_or_default();
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
            let _ = app.emit(
                "harvest:done",
                with_task(json!({ "source_count": created })),
            );
            // Chain the organize loop so the freshly-captured Sources fold
            // into the Wiki without a second click. Only when we actually
            // produced something — an empty harvest has nothing to organize.
            if created > 0 {
                let app2 = app.clone();
                let tid = task_id.clone();
                tokio::spawn(async move {
                    if let Err(e) = crate::commands::run_organize(app2.clone(), tid.clone()).await {
                        let _ = app2.emit(
                            "harvest:error",
                            json!({ "task_id": tid, "error": e }),
                        );
                    }
                });
            }
        }
        _ => {}
    }
}

/// Spawn the one-shot distill child process. The caller sends the prompt as a
/// user message once the returned handle is stored in `job_slot`.
pub async fn spawn_distill_process(
    app: AppHandle,
    claude_bin: String,
    tasks_root: PathBuf,
    task_id: String,
    job_slot: Arc<Mutex<Option<DistillJob>>>,
) -> Result<ProcessHandle, String> {
    // The distill process writes nothing to disk, but spawn_claude needs a
    // valid cwd; reuse the wiki dir (also ensures the task dir exists).
    let cwd = wiki_dir(&tasks_root, &task_id);
    std::fs::create_dir_all(&cwd).map_err(|e| e.to_string())?;
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

    spawn_claude(
        &claude_bin,
        &cwd_str,
        None,
        move |ev| {
            dispatch_event(
                &app_ev,
                job_ev.clone(),
                tasks_for_ev.clone(),
                task_for_ev.clone(),
                ev,
            );
        },
        move |line| {
            eprintln!("[distill stderr {task_for_err}] {line}");
            let _ = app_err.emit(
                "harvest:stderr",
                json!({ "task_id": task_for_err, "line": line }),
            );
        },
        move |_exited_id| {
            // Died before TurnEnd cleaned up — clear the slot so the next
            // click isn't blocked by a stale "already running" guard.
            if let Ok(mut guard) = job_exit.lock() {
                if guard.is_some() {
                    *guard = None;
                }
            }
            let _ = app_exit.emit(
                "harvest:exit",
                json!({ "task_id": task_for_exit }),
            );
        },
    )
    .await
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
        // A truncated/invalid array should yield no sources rather than panic.
        let out = parse_distilled_sources("[{\"content\": \"oops\", }]  trailing");
        assert!(out.is_empty());
    }

    #[test]
    fn transcript_renders_user_and_assistant() {
        let pairs = vec![pair(
            "인증 방식?",
            vec![
                AssistantSegment::Text {
                    text: "JWT를 씁니다".into(),
                },
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
                AssistantSegment::Thinking {
                    text: "secret reasoning".into(),
                },
                AssistantSegment::Text { text: "answer".into() },
            ],
        )];
        let t = render_transcript(&pairs);
        assert!(!t.contains("secret reasoning"));
        assert!(t.contains("answer"));
    }
}
