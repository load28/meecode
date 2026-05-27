//! Claude session lifecycle (ported from the Tauri lib's `commands.rs`).
//!
//! Per-tab Claude processes, their stdin/stdout pumps, and the mapping from
//! parsed `DomainEvent`s to `session:*` events. AppState's tab registry becomes
//! the process-global `state::tabs()`; `AppHandle.emit` becomes `emit_event`.

use crate::bridge::emit_event;
use crate::claude_process::protocol::{
    control_request_set_model, control_request_set_permission_mode,
    control_request_set_thinking_level, control_request_stop_task, control_response,
    control_response_error, user_multipart_message, user_text_message, PermissionBehavior,
    StdinMessage,
};
use crate::claude_process::spawn::{spawn_claude, ProcessHandle};
use crate::claude_process::stdout_parser::DomainEvent;
use crate::history::load_recent::{extract_qa_pairs, load_recent_pairs, projects_dir_for, QaPair};
use crate::state::tabs;
use serde::Deserialize;
use serde_json::json;
use std::sync::{Arc, Mutex};
use tokio::sync::mpsc::Sender;

pub struct TabState {
    pub process: Option<ProcessHandle>,
    pub session_id: Option<String>,
}

/// Each tab gets its own `Arc<Mutex<TabState>>` so per-tab work never contends
/// on a shared lock; the registry lock is held only to look up / insert / remove
/// the Arc — never across `.await` or stdin writes.
pub type TabHandle = Arc<Mutex<TabState>>;

const DEFAULT_TAB: &str = "main";

fn normalize_tab(tab_id: Option<String>) -> String {
    tab_id
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| DEFAULT_TAB.to_string())
}

fn get_or_init_tab(tab_id: &str) -> Result<TabHandle, String> {
    let mut map = tabs().lock().map_err(|e| e.to_string())?;
    Ok(map
        .entry(tab_id.to_string())
        .or_insert_with(|| {
            Arc::new(Mutex::new(TabState {
                process: None,
                session_id: None,
            }))
        })
        .clone())
}

fn get_tab(tab_id: &str) -> Result<Option<TabHandle>, String> {
    let map = tabs().lock().map_err(|e| e.to_string())?;
    Ok(map.get(tab_id).cloned())
}

fn chrono_now_millis() -> u128 {
    use std::time::{SystemTime, UNIX_EPOCH};
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0)
}

fn dispatch_event(tab_id: &str, ev: DomainEvent) {
    let with_tab = |mut v: serde_json::Value| -> serde_json::Value {
        if let Some(obj) = v.as_object_mut() {
            obj.insert("tab_id".to_string(), serde_json::Value::String(tab_id.to_string()));
        }
        v
    };
    match ev {
        DomainEvent::SessionStart { session_id } => {
            if let Ok(handle) = get_or_init_tab(tab_id) {
                if let Ok(mut entry) = handle.lock() {
                    entry.session_id = Some(session_id.clone());
                }
            }
            emit_event("session:start", with_tab(json!({ "session_id": session_id })));
        }
        DomainEvent::Message {
            kind,
            uuid,
            body,
            parent_tool_use_id,
        } => {
            emit_event(
                "session:message",
                with_tab(json!({
                    "kind": kind,
                    "uuid": uuid,
                    "body": body,
                    "parent_tool_use_id": parent_tool_use_id,
                })),
            );
        }
        DomainEvent::StreamEvent {
            event,
            parent_tool_use_id,
        } => {
            emit_event(
                "session:stream_event",
                with_tab(json!({ "event": event, "parent_tool_use_id": parent_tool_use_id })),
            );
        }
        DomainEvent::ToolProgress { raw } => {
            emit_event("session:tool_progress", with_tab(raw));
        }
        DomainEvent::TaskActivity { subtype, raw } => {
            let mut v = raw;
            if let Some(obj) = v.as_object_mut() {
                obj.insert("subtype".to_string(), serde_json::Value::String(subtype));
            }
            emit_event("session:task_activity", with_tab(v));
        }
        DomainEvent::ToolRequest {
            request_id,
            tool_name,
            input,
            tool_use_id,
            permission_suggestions,
            decision_reason,
            blocked_path,
            title,
        } => {
            emit_event(
                "session:tool_request",
                with_tab(json!({
                    "request_id": request_id,
                    "tool_name": tool_name,
                    "input": input,
                    "tool_use_id": tool_use_id,
                    "permission_suggestions": permission_suggestions,
                    "decision_reason": decision_reason,
                    "blocked_path": blocked_path,
                    "title": title,
                })),
            );
        }
        DomainEvent::UnsupportedControlRequest {
            request_id,
            subtype_hint,
        } => {
            // Claude waits for a control_response for every control_request; auto-
            // reply with a generic error so the session never stalls.
            eprintln!("[meecode] auto-replying error to control_request subtype={subtype_hint}");
            let tx_opt = get_tab(tab_id).ok().flatten().and_then(|h| {
                h.lock()
                    .ok()
                    .and_then(|g| g.process.as_ref().map(|p| p.stdin_tx.clone()))
            });
            if let Some(tx) = tx_opt {
                let msg = control_response_error(
                    request_id,
                    format!("meecode does not handle control_request subtype \"{subtype_hint}\""),
                );
                tokio::spawn(async move {
                    let _ = tx.send(msg).await;
                });
            }
        }
        DomainEvent::SessionInit {
            session_id,
            slash_commands,
            model,
            permission_mode,
            cwd,
            mcp_servers,
            agents,
            tools,
        } => {
            if let Some(ref id) = session_id {
                if let Ok(handle) = get_or_init_tab(tab_id) {
                    if let Ok(mut entry) = handle.lock() {
                        entry.session_id = Some(id.clone());
                    }
                }
            }
            emit_event(
                "session:init",
                with_tab(json!({
                    "session_id": session_id,
                    "slash_commands": slash_commands,
                    "model": model,
                    "permission_mode": permission_mode,
                    "cwd": cwd,
                    "mcp_servers": mcp_servers,
                    "agents": agents,
                    "tools": tools,
                })),
            );
        }
        DomainEvent::CompactBoundary => {
            emit_event("session:compact", with_tab(json!({})));
        }
        DomainEvent::HookActivity { hook_name, phase } => {
            emit_event(
                "session:hook",
                with_tab(json!({ "hook_name": hook_name, "phase": phase })),
            );
        }
        DomainEvent::RateLimit { raw } => {
            emit_event("session:rate_limit", with_tab(raw));
        }
        DomainEvent::ControlCancel { request_id } => {
            emit_event(
                "session:control_cancel",
                with_tab(json!({ "request_id": request_id })),
            );
        }
        DomainEvent::TurnEnd { raw } => {
            emit_event("session:turn_end", with_tab(raw));
        }
    }
}

pub async fn start_session(path: String, tab_id: Option<String>) -> Result<(), String> {
    let tab = normalize_tab(tab_id);
    let claude_bin = crate::state::get_config()?
        .claude_path
        .filter(|s| !s.trim().is_empty())
        .ok_or_else(|| "claude_path not configured — please set it in Settings.".to_string())?;

    let resume = match get_tab(&tab)? {
        Some(h) => h.lock().map_err(|e| e.to_string())?.session_id.clone(),
        None => None,
    };

    let history = if let Some(sid) = resume.as_ref() {
        let dir = projects_dir_for(&path).unwrap_or_default();
        let file = dir.join(format!("{sid}.jsonl"));
        if file.exists() {
            extract_qa_pairs(&file)
        } else {
            load_recent_pairs(&path).unwrap_or_default()
        }
    } else {
        Vec::<QaPair>::new()
    };
    emit_event("session:history", json!({ "tab_id": tab, "pairs": history }));

    let tab_for_events = tab.clone();
    let tab_for_stderr = tab.clone();
    let tab_for_exit = tab.clone();
    let handle = spawn_claude(
        &claude_bin,
        &path,
        resume.as_deref(),
        move |ev| dispatch_event(&tab_for_events, ev),
        move |line| {
            eprintln!("[claude stderr {tab_for_stderr}] {line}");
            emit_event("session:stderr", json!({ "tab_id": tab_for_stderr, "line": line }));
        },
        move |exited_id: u64| {
            // Only clear the handle (and fire session:exit) if this exit belongs
            // to the *current* process — a back-to-back switch_session may have
            // already replaced us with a newer process.
            let is_current = if let Ok(Some(h)) = get_tab(&tab_for_exit) {
                if let Ok(mut entry) = h.lock() {
                    let same = entry.process.as_ref().map(|p| p.id == exited_id).unwrap_or(false);
                    if same {
                        entry.process = None;
                    }
                    same
                } else {
                    false
                }
            } else {
                false
            };
            if !is_current {
                return;
            }
            emit_event("session:exit", json!({ "tab_id": tab_for_exit }));
        },
    )
    .await?;

    let h = get_or_init_tab(&tab)?;
    h.lock().map_err(|e| e.to_string())?.process = Some(handle);
    Ok(())
}

async fn send_to_stdin(tab_id: &str, msg: StdinMessage) -> Result<(), String> {
    let handle = get_tab(tab_id)?.ok_or("no active session for tab")?;
    let tx: Sender<StdinMessage> = handle
        .lock()
        .map_err(|e| e.to_string())?
        .process
        .as_ref()
        .map(|h| h.stdin_tx.clone())
        .ok_or("no active session")?;
    tx.send(msg).await.map_err(|e| e.to_string())
}

#[derive(Deserialize)]
pub struct ImageAttachment {
    pub media_type: String,
    pub data: String,
}

pub async fn send_user_message(
    text: String,
    images: Option<Vec<ImageAttachment>>,
    tab_id: Option<String>,
) -> Result<(), String> {
    let tab = normalize_tab(tab_id);
    let imgs = images.unwrap_or_default();
    if imgs.is_empty() {
        send_to_stdin(&tab, user_text_message(text)).await
    } else {
        let pairs = imgs.into_iter().map(|a| (a.media_type, a.data)).collect::<Vec<_>>();
        send_to_stdin(&tab, user_multipart_message(text, pairs)).await
    }
}

#[derive(Deserialize)]
pub struct ToolResponseArgs {
    pub request_id: String,
    pub allow: bool,
    #[serde(default)]
    pub tool_use_id: Option<String>,
    #[serde(default)]
    pub updated_input: Option<serde_json::Value>,
    #[serde(default)]
    pub tab_id: Option<String>,
    #[serde(default)]
    pub denial_message: Option<String>,
}

pub async fn send_tool_response(args: ToolResponseArgs) -> Result<(), String> {
    let tab = normalize_tab(args.tab_id);
    let behavior = if args.allow {
        PermissionBehavior::Allow
    } else {
        PermissionBehavior::Deny
    };
    send_to_stdin(
        &tab,
        control_response(
            args.request_id,
            behavior,
            args.tool_use_id,
            args.updated_input,
            args.denial_message,
        ),
    )
    .await
}

pub async fn interrupt_session(tab_id: Option<String>) -> Result<(), String> {
    let tab = normalize_tab(tab_id);
    let request_id = format!("interrupt-{}", chrono_now_millis());
    send_to_stdin(&tab, control_request_stop_task(request_id)).await
}

pub async fn set_permission_mode(mode: String, tab_id: Option<String>) -> Result<(), String> {
    let tab = normalize_tab(tab_id);
    let request_id = format!("mode-{}", chrono_now_millis());
    send_to_stdin(&tab, control_request_set_permission_mode(request_id, &mode)).await
}

pub async fn set_model(model: Option<String>, tab_id: Option<String>) -> Result<(), String> {
    let tab = normalize_tab(tab_id);
    let request_id = format!("model-{}", chrono_now_millis());
    send_to_stdin(&tab, control_request_set_model(request_id, model.as_deref())).await
}

pub async fn set_thinking_level(level: String, tab_id: Option<String>) -> Result<(), String> {
    let tab = normalize_tab(tab_id);
    let request_id = format!("think-{}", chrono_now_millis());
    send_to_stdin(&tab, control_request_set_thinking_level(request_id, &level)).await
}

pub async fn switch_session(
    path: String,
    session_id: Option<String>,
    tab_id: Option<String>,
) -> Result<(), String> {
    let tab = normalize_tab(tab_id);
    let handle = get_or_init_tab(&tab)?;
    {
        let mut entry = handle.lock().map_err(|e| e.to_string())?;
        if let Some(mut h) = entry.process.take() {
            h.kill();
        }
        entry.session_id = session_id;
    }
    start_session(path, Some(tab)).await
}

/// Kill a background tab's Claude process while preserving its `session_id` for
/// a later `--resume`. Because we `take()` the process before `kill()`, the exit
/// callback sees `process == None`, treats the exit as stale, and does not emit
/// `session:exit`.
pub fn hibernate_tab(tab_id: String) -> Result<(), String> {
    if let Some(handle) = get_tab(&tab_id)? {
        let mut entry = handle.lock().map_err(|e| e.to_string())?;
        if let Some(mut h) = entry.process.take() {
            h.kill();
        }
    }
    Ok(())
}

pub fn close_tab(tab_id: String) -> Result<(), String> {
    let removed = {
        let mut map = tabs().lock().map_err(|e| e.to_string())?;
        map.remove(&tab_id)
    };
    if let Some(handle) = removed {
        if let Ok(mut entry) = handle.lock() {
            if let Some(mut h) = entry.process.take() {
                h.kill();
            }
        }
    }
    Ok(())
}
