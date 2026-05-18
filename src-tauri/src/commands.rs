use crate::claude_process::protocol::{
    control_request_set_model, control_request_set_permission_mode,
    control_request_set_thinking_level, control_request_stop_task, control_response,
    control_response_error, user_multipart_message, user_text_message, PermissionBehavior,
    StdinMessage,
};
use crate::claude_process::spawn::{spawn_claude, ProcessHandle};
use crate::claude_process::stdout_parser::DomainEvent;
use crate::config::Config;
use crate::history::load_recent::load_recent_pairs;
use serde::Deserialize;
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, Manager, State};
use tokio::sync::mpsc::Sender;

pub struct AppState {
    pub process: Mutex<Option<ProcessHandle>>,
    pub session_id: Mutex<Option<String>>,
    pub config: Mutex<Config>,
}

impl AppState {
    pub fn new() -> Self {
        Self {
            process: Mutex::new(None),
            session_id: Mutex::new(None),
            config: Mutex::new(Config::load()),
        }
    }
}

fn dispatch_event(app: &AppHandle, ev: DomainEvent) {
    match ev {
        DomainEvent::SessionStart { session_id } => {
            if let Some(state) = app.try_state::<AppState>() {
                if let Ok(mut guard) = state.session_id.lock() {
                    *guard = Some(session_id.clone());
                }
            }
            let _ = app.emit(
                "session:start",
                serde_json::json!({ "session_id": session_id }),
            );
        }
        DomainEvent::Message { kind, uuid, body } => {
            let _ = app.emit(
                "session:message",
                serde_json::json!({
                    "kind": kind,
                    "uuid": uuid,
                    "body": body,
                }),
            );
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
            let _ = app.emit(
                "session:tool_request",
                serde_json::json!({
                    "request_id": request_id,
                    "tool_name": tool_name,
                    "input": input,
                    "tool_use_id": tool_use_id,
                    "permission_suggestions": permission_suggestions,
                    "decision_reason": decision_reason,
                    "blocked_path": blocked_path,
                    "title": title,
                }),
            );
        }
        DomainEvent::UnsupportedControlRequest {
            request_id,
            subtype_hint,
        } => {
            // Claude waits for a control_response for every control_request it
            // sends. Auto-reply with a generic error so the session never
            // stalls on a subtype we have no UI for.
            eprintln!("[meecode] auto-replying error to control_request subtype={subtype_hint}");
            if let Some(state) = app.try_state::<AppState>() {
                let tx_opt = state
                    .process
                    .lock()
                    .ok()
                    .and_then(|g| g.as_ref().map(|h| h.stdin_tx.clone()));
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
                if let Some(state) = app.try_state::<AppState>() {
                    if let Ok(mut guard) = state.session_id.lock() {
                        *guard = Some(id.clone());
                    }
                }
            }
            let _ = app.emit(
                "session:init",
                serde_json::json!({
                    "session_id": session_id,
                    "slash_commands": slash_commands,
                    "model": model,
                    "permission_mode": permission_mode,
                    "cwd": cwd,
                    "mcp_servers": mcp_servers,
                    "agents": agents,
                    "tools": tools,
                }),
            );
        }
        DomainEvent::CompactBoundary => {
            let _ = app.emit("session:compact", serde_json::json!({}));
        }
        DomainEvent::HookActivity { hook_name, phase } => {
            let _ = app.emit(
                "session:hook",
                serde_json::json!({ "hook_name": hook_name, "phase": phase }),
            );
        }
        DomainEvent::RateLimit { raw } => {
            let _ = app.emit("session:rate_limit", raw);
        }
        DomainEvent::ControlCancel { request_id } => {
            let _ = app.emit(
                "session:control_cancel",
                serde_json::json!({ "request_id": request_id }),
            );
        }
        DomainEvent::TurnEnd { raw } => {
            let _ = app.emit("session:turn_end", raw);
        }
    }
}

#[tauri::command]
pub async fn start_session(app: AppHandle, path: String) -> Result<(), String> {
    let claude_bin = {
        let state = app.state::<AppState>();
        let cfg = state.config.lock().map_err(|e| e.to_string())?;
        cfg.claude_path
            .clone()
            .unwrap_or_else(|| "claude".to_string())
    };

    let history = load_recent_pairs(&path).unwrap_or_default();
    app.emit("session:history", &history)
        .map_err(|e| e.to_string())?;

    let resume = {
        let state = app.state::<AppState>();
        let guard = state.session_id.lock().map_err(|e| e.to_string())?;
        guard.clone()
    };
    let app_for_events = app.clone();
    let app_for_stderr = app.clone();
    let handle = spawn_claude(
        &claude_bin,
        &path,
        resume.as_deref(),
        move |ev| dispatch_event(&app_for_events, ev),
        move |line| {
            eprintln!("[claude stderr] {line}");
            let _ = app_for_stderr.emit("session:stderr", line);
        },
    )
    .await?;

    let state = app.state::<AppState>();
    *state.process.lock().map_err(|e| e.to_string())? = Some(handle);
    Ok(())
}

async fn send_to_stdin(app: &AppHandle, msg: StdinMessage) -> Result<(), String> {
    let tx: Sender<StdinMessage> = {
        let state = app.state::<AppState>();
        let guard = state.process.lock().map_err(|e| e.to_string())?;
        guard.as_ref().ok_or("no active session")?.stdin_tx.clone()
    };
    tx.send(msg).await.map_err(|e| e.to_string())
}

#[derive(Deserialize)]
pub struct ImageAttachment {
    pub media_type: String,
    pub data: String,
}

#[tauri::command]
pub async fn send_user_message(
    app: AppHandle,
    text: String,
    #[allow(non_snake_case)] images: Option<Vec<ImageAttachment>>,
) -> Result<(), String> {
    let imgs = images.unwrap_or_default();
    if imgs.is_empty() {
        send_to_stdin(&app, user_text_message(text)).await
    } else {
        let pairs = imgs
            .into_iter()
            .map(|a| (a.media_type, a.data))
            .collect::<Vec<_>>();
        send_to_stdin(&app, user_multipart_message(text, pairs)).await
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
}

#[tauri::command]
pub async fn send_tool_response(
    app: AppHandle,
    args: ToolResponseArgs,
) -> Result<(), String> {
    let behavior = if args.allow {
        PermissionBehavior::Allow
    } else {
        PermissionBehavior::Deny
    };
    send_to_stdin(
        &app,
        control_response(args.request_id, behavior, args.tool_use_id, args.updated_input),
    )
    .await
}

#[tauri::command]
pub async fn interrupt_session(app: AppHandle) -> Result<(), String> {
    let request_id = format!("interrupt-{}", chrono_now_millis());
    send_to_stdin(&app, control_request_stop_task(request_id)).await
}

#[tauri::command]
pub async fn set_permission_mode(app: AppHandle, mode: String) -> Result<(), String> {
    let request_id = format!("mode-{}", chrono_now_millis());
    send_to_stdin(
        &app,
        control_request_set_permission_mode(request_id, &mode),
    )
    .await
}

#[tauri::command]
pub async fn set_model(app: AppHandle, model: Option<String>) -> Result<(), String> {
    let request_id = format!("model-{}", chrono_now_millis());
    send_to_stdin(
        &app,
        control_request_set_model(request_id, model.as_deref()),
    )
    .await
}

#[tauri::command]
pub async fn set_thinking_level(app: AppHandle, level: String) -> Result<(), String> {
    let request_id = format!("think-{}", chrono_now_millis());
    send_to_stdin(
        &app,
        control_request_set_thinking_level(request_id, &level),
    )
    .await
}

fn chrono_now_millis() -> u128 {
    use std::time::{SystemTime, UNIX_EPOCH};
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0)
}

#[derive(serde::Deserialize)]
pub struct SearchFilesArgs {
    pub project_path: String,
    pub query: String,
}

#[tauri::command]
pub fn search_files(args: SearchFilesArgs) -> Result<Vec<String>, String> {
    use std::collections::VecDeque;
    use std::fs;
    use std::path::PathBuf;

    let root = PathBuf::from(&args.project_path);
    if !root.is_dir() {
        return Ok(Vec::new());
    }
    let query = args.query.to_lowercase();
    let mut out: Vec<String> = Vec::new();
    let mut stack: VecDeque<PathBuf> = VecDeque::from([root.clone()]);
    let mut visited = 0usize;
    const MAX_VISIT: usize = 20_000;
    const MAX_RESULTS: usize = 50;
    const SKIP_DIRS: &[&str] = &[
        "node_modules", ".git", "target", "dist", "build", ".next", ".cache", ".turbo",
    ];

    while let Some(dir) = stack.pop_front() {
        if visited > MAX_VISIT || out.len() >= MAX_RESULTS {
            break;
        }
        visited += 1;
        let Ok(entries) = fs::read_dir(&dir) else { continue };
        for entry in entries.flatten() {
            let path = entry.path();
            let name = entry.file_name().to_string_lossy().to_string();
            if name.starts_with('.') && name != ".env.example" {
                continue;
            }
            let is_dir = entry.file_type().map(|t| t.is_dir()).unwrap_or(false);
            if is_dir {
                if SKIP_DIRS.contains(&name.as_str()) {
                    continue;
                }
                stack.push_back(path);
                continue;
            }
            let rel = path
                .strip_prefix(&root)
                .ok()
                .map(|p| p.to_string_lossy().to_string())
                .unwrap_or(name.clone());
            if query.is_empty() || rel.to_lowercase().contains(&query) {
                out.push(rel);
                if out.len() >= MAX_RESULTS {
                    break;
                }
            }
        }
    }

    out.sort_by_key(|p| (p.len(), p.clone()));
    Ok(out)
}

#[tauri::command]
pub fn open_external(path: String) -> Result<(), String> {
    // Resolve relative paths against the current project, if known.
    use std::process::Command;
    #[cfg(target_os = "macos")]
    let prog = "open";
    #[cfg(target_os = "linux")]
    let prog = "xdg-open";
    #[cfg(target_os = "windows")]
    let prog = "explorer";
    Command::new(prog)
        .arg(&path)
        .spawn()
        .map(|_| ())
        .map_err(|e| format!("open_external failed: {e}"))
}

#[tauri::command]
pub fn get_config(state: State<AppState>) -> Result<Config, String> {
    Ok(state.config.lock().map_err(|e| e.to_string())?.clone())
}

#[tauri::command]
pub fn set_config(config: Config, state: State<AppState>) -> Result<(), String> {
    config.save()?;
    *state.config.lock().map_err(|e| e.to_string())? = config;
    Ok(())
}
