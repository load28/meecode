use crate::claude_process::protocol::{
    control_request_set_model, control_request_set_permission_mode,
    control_request_set_thinking_level, control_request_stop_task, control_response,
    control_response_error, user_multipart_message, user_text_message, PermissionBehavior,
    StdinMessage,
};
use crate::claude_process::spawn::{spawn_claude, ProcessHandle};
use crate::claude_process::stdout_parser::DomainEvent;
use crate::config::Config;
use crate::history::list::{list_projects, list_sessions, ProjectInfo, SessionInfo};
use crate::history::load_recent::{extract_qa_pairs, load_recent_pairs, projects_dir_for, QaPair};
use crate::organize::{build_prompt, diff_entries, extract_assistant_text, parse_wiki_response};
use crate::pins::{
    append_pin, delete_pin, delete_wiki_file, list_pins, list_wiki_files, read_wiki_file,
    write_wiki_file, Pin, WikiFile,
};
use serde::Deserialize;
use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Emitter, Manager, State};
use tokio::sync::mpsc::Sender;

pub struct TabState {
    pub process: Option<ProcessHandle>,
    pub session_id: Option<String>,
}

/// Each tab gets its own `Arc<Mutex<TabState>>` so per-tab work never
/// contends on a shared lock. The outer registry lock is only held long
/// enough to look up / insert / remove the Arc — never across `.await`,
/// never across stdin writes — so two tabs running concurrent turns do
/// not block each other.
pub type TabHandle = Arc<Mutex<TabState>>;

pub struct OrganizeJob {
    pub process: ProcessHandle,
    pub project_path: String,
    pub accumulated: Arc<Mutex<String>>,
}

pub struct AppState {
    pub tabs: Mutex<HashMap<String, TabHandle>>,
    pub config: Mutex<Config>,
    /// Single-slot background job for the "organize pins → wiki" feature.
    /// One job runs at a time per app; concurrent invocations error out so
    /// the user gets clear feedback rather than racing claude processes.
    pub organize: Mutex<Option<OrganizeJob>>,
}

impl AppState {
    pub fn new() -> Self {
        Self {
            tabs: Mutex::new(HashMap::new()),
            config: Mutex::new(Config::load()),
            organize: Mutex::new(None),
        }
    }
}

const DEFAULT_TAB: &str = "main";

fn normalize_tab(tab_id: Option<String>) -> String {
    tab_id
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| DEFAULT_TAB.to_string())
}

/// Look up the per-tab handle, creating it if missing. Holds the outer
/// registry lock only for the duration of the HashMap operation.
fn get_or_init_tab(state: &AppState, tab_id: &str) -> Result<TabHandle, String> {
    let mut tabs = state.tabs.lock().map_err(|e| e.to_string())?;
    Ok(tabs
        .entry(tab_id.to_string())
        .or_insert_with(|| {
            Arc::new(Mutex::new(TabState {
                process: None,
                session_id: None,
            }))
        })
        .clone())
}

/// Look up the per-tab handle without creating one.
fn get_tab(state: &AppState, tab_id: &str) -> Result<Option<TabHandle>, String> {
    let tabs = state.tabs.lock().map_err(|e| e.to_string())?;
    Ok(tabs.get(tab_id).cloned())
}

fn dispatch_event(app: &AppHandle, tab_id: &str, ev: DomainEvent) {
    let with_tab = |mut v: serde_json::Value| -> serde_json::Value {
        if let Some(obj) = v.as_object_mut() {
            obj.insert(
                "tab_id".to_string(),
                serde_json::Value::String(tab_id.to_string()),
            );
        }
        v
    };
    match ev {
        DomainEvent::SessionStart { session_id } => {
            if let Some(state) = app.try_state::<AppState>() {
                if let Ok(handle) = get_or_init_tab(&state, tab_id) {
                    if let Ok(mut entry) = handle.lock() {
                        entry.session_id = Some(session_id.clone());
                    }
                }
            }
            let _ = app.emit(
                "session:start",
                with_tab(serde_json::json!({ "session_id": session_id })),
            );
        }
        DomainEvent::Message {
            kind,
            uuid,
            body,
            parent_tool_use_id,
        } => {
            let _ = app.emit(
                "session:message",
                with_tab(serde_json::json!({
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
            let _ = app.emit(
                "session:stream_event",
                with_tab(serde_json::json!({
                    "event": event,
                    "parent_tool_use_id": parent_tool_use_id,
                })),
            );
        }
        DomainEvent::ToolProgress { raw } => {
            let _ = app.emit("session:tool_progress", with_tab(raw));
        }
        DomainEvent::TaskActivity { subtype, raw } => {
            let mut v = raw;
            if let Some(obj) = v.as_object_mut() {
                obj.insert("subtype".to_string(), serde_json::Value::String(subtype));
            }
            let _ = app.emit("session:task_activity", with_tab(v));
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
                with_tab(serde_json::json!({
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
            // Claude waits for a control_response for every control_request it
            // sends. Auto-reply with a generic error so the session never
            // stalls on a subtype we have no UI for.
            eprintln!("[meecode] auto-replying error to control_request subtype={subtype_hint}");
            if let Some(state) = app.try_state::<AppState>() {
                let tx_opt = get_tab(&state, tab_id).ok().flatten().and_then(|h| {
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
                    if let Ok(handle) = get_or_init_tab(&state, tab_id) {
                        if let Ok(mut entry) = handle.lock() {
                            entry.session_id = Some(id.clone());
                        }
                    }
                }
            }
            let _ = app.emit(
                "session:init",
                with_tab(serde_json::json!({
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
            let _ = app.emit("session:compact", with_tab(serde_json::json!({})));
        }
        DomainEvent::HookActivity { hook_name, phase } => {
            let _ = app.emit(
                "session:hook",
                with_tab(serde_json::json!({ "hook_name": hook_name, "phase": phase })),
            );
        }
        DomainEvent::RateLimit { raw } => {
            let _ = app.emit("session:rate_limit", with_tab(raw));
        }
        DomainEvent::ControlCancel { request_id } => {
            let _ = app.emit(
                "session:control_cancel",
                with_tab(serde_json::json!({ "request_id": request_id })),
            );
        }
        DomainEvent::TurnEnd { raw } => {
            let _ = app.emit("session:turn_end", with_tab(raw));
        }
    }
}

#[tauri::command]
pub async fn start_session(
    app: AppHandle,
    path: String,
    tab_id: Option<String>,
) -> Result<(), String> {
    println!(
        "[meecode][start_session] tab_id={:?} path={}",
        tab_id, path
    );
    let tab = normalize_tab(tab_id);
    let claude_bin = {
        let state = app.state::<AppState>();
        let cfg = state.config.lock().map_err(|e| e.to_string())?;
        cfg.claude_path
            .clone()
            .filter(|s| !s.trim().is_empty())
            .ok_or_else(|| {
                "claude_path not configured — please set it in Settings.".to_string()
            })?
    };

    let resume = {
        let state = app.state::<AppState>();
        match get_tab(&state, &tab)? {
            Some(h) => h
                .lock()
                .map_err(|e| e.to_string())?
                .session_id
                .clone(),
            None => None,
        }
    };

    let history = if let Some(sid) = resume.as_ref() {
        let dir = projects_dir_for(&path).unwrap_or_default();
        let file = dir.join(format!("{sid}.jsonl"));
        let file_exists = file.exists();
        println!(
            "[meecode][history] tab={tab} resume={sid} file={:?} exists={file_exists}",
            file
        );
        if file_exists {
            extract_qa_pairs(&file)
        } else {
            load_recent_pairs(&path).unwrap_or_default()
        }
    } else {
        println!("[meecode][history] tab={tab} resume=None → empty");
        Vec::<QaPair>::new()
    };
    println!(
        "[meecode][history] tab={tab} emitting {} pair(s)",
        history.len()
    );
    app.emit(
        "session:history",
        serde_json::json!({ "tab_id": tab, "pairs": history }),
    )
    .map_err(|e| e.to_string())?;
    let app_for_events = app.clone();
    let app_for_stderr = app.clone();
    let app_for_exit = app.clone();
    let tab_for_events = tab.clone();
    let tab_for_stderr = tab.clone();
    let tab_for_exit = tab.clone();
    let handle = spawn_claude(
        &claude_bin,
        &path,
        resume.as_deref(),
        move |ev| dispatch_event(&app_for_events, &tab_for_events, ev),
        move |line| {
            eprintln!("[claude stderr {tab_for_stderr}] {line}");
            let _ = app_for_stderr.emit(
                "session:stderr",
                serde_json::json!({ "tab_id": tab_for_stderr, "line": line }),
            );
        },
        move |exited_id: u64| {
            // Only clear the handle if this exit belongs to the *current*
            // process. A back-to-back switch_session can replace us with a
            // newer process whose stdin we must not wipe.
            let is_current = if let Some(state) = app_for_exit.try_state::<AppState>() {
                if let Ok(Some(h)) = get_tab(&state, &tab_for_exit) {
                    if let Ok(mut entry) = h.lock() {
                        let same = entry
                            .process
                            .as_ref()
                            .map(|p| p.id == exited_id)
                            .unwrap_or(false);
                        if same {
                            entry.process = None;
                        }
                        same
                    } else {
                        false
                    }
                } else {
                    false
                }
            } else {
                false
            };
            if !is_current {
                // Stale exit from a process that was already replaced —
                // ignore so we don't fire `session:exit` over a live session.
                return;
            }
            let _ = app_for_exit.emit(
                "session:exit",
                serde_json::json!({ "tab_id": tab_for_exit }),
            );
        },
    )
    .await?;

    let state = app.state::<AppState>();
    let h = get_or_init_tab(&state, &tab)?;
    h.lock().map_err(|e| e.to_string())?.process = Some(handle);
    Ok(())
}

async fn send_to_stdin(
    app: &AppHandle,
    tab_id: &str,
    msg: StdinMessage,
) -> Result<(), String> {
    // Clone the mpsc sender out of the per-tab state under a short lock,
    // then drop both locks before awaiting the send. The outer registry
    // lock is held just long enough to grab the per-tab Arc.
    let handle = get_tab(&app.state::<AppState>(), tab_id)?
        .ok_or("no active session for tab")?;
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

#[tauri::command]
pub async fn send_user_message(
    app: AppHandle,
    text: String,
    #[allow(non_snake_case)] images: Option<Vec<ImageAttachment>>,
    tab_id: Option<String>,
) -> Result<(), String> {
    let tab = normalize_tab(tab_id);
    let imgs = images.unwrap_or_default();
    if imgs.is_empty() {
        send_to_stdin(&app, &tab, user_text_message(text)).await
    } else {
        let pairs = imgs
            .into_iter()
            .map(|a| (a.media_type, a.data))
            .collect::<Vec<_>>();
        send_to_stdin(&app, &tab, user_multipart_message(text, pairs)).await
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
}

#[tauri::command]
pub async fn send_tool_response(
    app: AppHandle,
    args: ToolResponseArgs,
) -> Result<(), String> {
    let tab = normalize_tab(args.tab_id);
    let behavior = if args.allow {
        PermissionBehavior::Allow
    } else {
        PermissionBehavior::Deny
    };
    send_to_stdin(
        &app,
        &tab,
        control_response(args.request_id, behavior, args.tool_use_id, args.updated_input),
    )
    .await
}

#[tauri::command]
pub async fn interrupt_session(
    app: AppHandle,
    tab_id: Option<String>,
) -> Result<(), String> {
    let tab = normalize_tab(tab_id);
    let request_id = format!("interrupt-{}", chrono_now_millis());
    send_to_stdin(&app, &tab, control_request_stop_task(request_id)).await
}

#[tauri::command]
pub async fn set_permission_mode(
    app: AppHandle,
    mode: String,
    tab_id: Option<String>,
) -> Result<(), String> {
    let tab = normalize_tab(tab_id);
    let request_id = format!("mode-{}", chrono_now_millis());
    send_to_stdin(
        &app,
        &tab,
        control_request_set_permission_mode(request_id, &mode),
    )
    .await
}

#[tauri::command]
pub async fn set_model(
    app: AppHandle,
    model: Option<String>,
    tab_id: Option<String>,
) -> Result<(), String> {
    let tab = normalize_tab(tab_id);
    let request_id = format!("model-{}", chrono_now_millis());
    send_to_stdin(
        &app,
        &tab,
        control_request_set_model(request_id, model.as_deref()),
    )
    .await
}

#[tauri::command]
pub async fn set_thinking_level(
    app: AppHandle,
    level: String,
    tab_id: Option<String>,
) -> Result<(), String> {
    let tab = normalize_tab(tab_id);
    let request_id = format!("think-{}", chrono_now_millis());
    send_to_stdin(
        &app,
        &tab,
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
pub fn list_recent_projects() -> Result<Vec<ProjectInfo>, String> {
    list_projects()
}

#[tauri::command]
pub fn list_project_sessions(path: String) -> Result<Vec<SessionInfo>, String> {
    list_sessions(&path)
}

#[tauri::command]
pub async fn switch_session(
    app: AppHandle,
    path: String,
    session_id: Option<String>,
    tab_id: Option<String>,
) -> Result<(), String> {
    println!(
        "[meecode][switch_session] tab_id={:?} session_id={:?} path={}",
        tab_id, session_id, path
    );
    let tab = normalize_tab(tab_id);
    let state = app.state::<AppState>();
    let handle = get_or_init_tab(&state, &tab)?;
    {
        let mut entry = handle.lock().map_err(|e| e.to_string())?;
        if let Some(mut h) = entry.process.take() {
            h.kill();
        }
        entry.session_id = session_id;
    }
    drop(state);
    start_session(app, path, Some(tab)).await
}

#[tauri::command]
pub fn close_tab(app: AppHandle, tab_id: String) -> Result<(), String> {
    let state = app.state::<AppState>();
    // Remove from the registry first so any in-flight send/kill from this
    // tab can't observe a dangling Arc afterwards.
    let removed = {
        let mut tabs = state.tabs.lock().map_err(|e| e.to_string())?;
        tabs.remove(&tab_id)
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

#[derive(serde::Serialize)]
pub struct FileContent {
    pub path: String,
    pub content: String,
    pub language: String,
    pub size: u64,
    pub truncated: bool,
}

const MAX_FILE_BYTES: u64 = 2 * 1024 * 1024;

fn detect_language(path: &str) -> &'static str {
    let lower = path.to_lowercase();
    let ext = lower.rsplit('.').next().unwrap_or("");
    match ext {
        "rs" => "rust",
        "ts" | "mts" | "cts" => "typescript",
        "tsx" => "tsx",
        "js" | "mjs" | "cjs" => "javascript",
        "jsx" => "jsx",
        "json" => "json",
        "html" | "htm" => "markup",
        "xml" | "svg" => "markup",
        "css" => "css",
        "scss" | "sass" => "scss",
        "py" => "python",
        "rb" => "ruby",
        "go" => "go",
        "java" => "java",
        "kt" | "kts" => "kotlin",
        "swift" => "swift",
        "c" | "h" => "c",
        "cpp" | "cc" | "cxx" | "hpp" => "cpp",
        "cs" => "csharp",
        "php" => "php",
        "sh" | "bash" | "zsh" => "bash",
        "yml" | "yaml" => "yaml",
        "toml" => "toml",
        "md" | "markdown" => "markdown",
        "sql" => "sql",
        "graphql" | "gql" => "graphql",
        _ => "plaintext",
    }
}

#[tauri::command]
pub fn read_file_text(path: String) -> Result<FileContent, String> {
    use std::fs;
    let meta = fs::metadata(&path).map_err(|e| format!("metadata: {e}"))?;
    if !meta.is_file() {
        return Err("not a file".into());
    }
    let size = meta.len();
    let truncated = size > MAX_FILE_BYTES;
    let bytes = if truncated {
        let mut buf = vec![0u8; MAX_FILE_BYTES as usize];
        use std::io::Read;
        let mut f = fs::File::open(&path).map_err(|e| format!("open: {e}"))?;
        f.read_exact(&mut buf).map_err(|e| format!("read: {e}"))?;
        buf
    } else {
        fs::read(&path).map_err(|e| format!("read: {e}"))?
    };
    let content = String::from_utf8_lossy(&bytes).into_owned();
    let language = detect_language(&path).to_string();
    Ok(FileContent {
        path,
        content,
        language,
        size,
        truncated,
    })
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

#[derive(serde::Serialize)]
pub struct ValidationOk {
    pub path: String,
}

#[derive(serde::Serialize)]
pub struct ClaudeStatus {
    pub path: Option<String>,
    pub ready: bool,
    pub error: Option<crate::claude_discovery::ValidationError>,
}

#[tauri::command]
pub async fn discover_claude_path() -> Result<Option<String>, String> {
    Ok(crate::claude_discovery::discover_claude().await)
}

#[tauri::command]
pub async fn validate_claude_path(
    path: String,
) -> Result<ValidationOk, crate::claude_discovery::ValidationError> {
    crate::claude_discovery::validate_claude(&path)
        .await
        .map(|p| ValidationOk { path: p })
}

#[tauri::command]
pub fn set_claude_path(app: AppHandle, path: Option<String>) -> Result<(), String> {
    let normalized = path
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty());
    let cfg = {
        let state = app.state::<AppState>();
        let mut guard = state.config.lock().map_err(|e| e.to_string())?;
        guard.claude_path = normalized.clone();
        guard.clone()
    };
    cfg.save()?;
    let _ = app.emit(
        "claude_path:changed",
        serde_json::json!({ "path": normalized }),
    );
    Ok(())
}

#[derive(Deserialize)]
pub struct PinSnippetArgs {
    pub project_path: String,
    #[serde(default)]
    pub session_id: Option<String>,
    #[serde(default)]
    pub qa_id: Option<String>,
    pub segment_kind: String,
    pub text: String,
}

#[tauri::command]
pub fn pin_snippet(args: PinSnippetArgs) -> Result<Pin, String> {
    append_pin(
        &args.project_path,
        args.session_id,
        args.qa_id,
        args.segment_kind,
        args.text,
    )
}

#[tauri::command]
pub fn list_project_pins(project_path: String) -> Result<Vec<Pin>, String> {
    list_pins(&project_path)
}

#[derive(Deserialize)]
pub struct DeletePinArgs {
    pub project_path: String,
    pub pin_id: String,
}

#[tauri::command]
pub fn delete_project_pin(args: DeletePinArgs) -> Result<(), String> {
    delete_pin(&args.project_path, &args.pin_id)
}

#[tauri::command]
pub fn list_project_wiki(project_path: String) -> Result<Vec<WikiFile>, String> {
    list_wiki_files(&project_path)
}

#[derive(Deserialize)]
pub struct ReadWikiArgs {
    pub project_path: String,
    pub file_name: String,
}

#[tauri::command]
pub fn read_project_wiki(args: ReadWikiArgs) -> Result<String, String> {
    read_wiki_file(&args.project_path, &args.file_name)
}

#[derive(Deserialize)]
pub struct ApplyWikiDiffArgs {
    pub project_path: String,
    pub file_name: String,
    pub content: String,
}

#[tauri::command]
pub fn apply_wiki_diff(args: ApplyWikiDiffArgs) -> Result<(), String> {
    write_wiki_file(&args.project_path, &args.file_name, &args.content)
}

#[derive(Deserialize)]
pub struct DeleteWikiArgs {
    pub project_path: String,
    pub file_name: String,
}

#[tauri::command]
pub fn delete_project_wiki(args: DeleteWikiArgs) -> Result<(), String> {
    delete_wiki_file(&args.project_path, &args.file_name)
}

fn handle_organize_event(
    app: &AppHandle,
    project_path: &str,
    accumulated: &Arc<Mutex<String>>,
    ev: DomainEvent,
) {
    match ev {
        DomainEvent::Message { kind, body, .. } if kind == "assistant" => {
            let text = extract_assistant_text(&body);
            if text.is_empty() {
                return;
            }
            let chars = {
                let mut buf = match accumulated.lock() {
                    Ok(b) => b,
                    Err(_) => return,
                };
                buf.push_str(&text);
                buf.len()
            };
            let _ = app.emit(
                "organize:progress",
                serde_json::json!({
                    "project_path": project_path,
                    "chars": chars,
                }),
            );
        }
        DomainEvent::ToolRequest {
            request_id,
            tool_use_id,
            ..
        } => {
            // Organize runs in a "no tools" contract — auto-deny anything
            // claude tries to invoke so the prompt is the only input.
            if let Some(state) = app.try_state::<AppState>() {
                let tx_opt = state
                    .organize
                    .lock()
                    .ok()
                    .and_then(|s| s.as_ref().map(|j| j.process.stdin_tx.clone()));
                if let Some(tx) = tx_opt {
                    let msg = control_response(
                        request_id,
                        PermissionBehavior::Deny,
                        tool_use_id,
                        None,
                    );
                    tokio::spawn(async move {
                        let _ = tx.send(msg).await;
                    });
                }
            }
        }
        DomainEvent::UnsupportedControlRequest { request_id, .. } => {
            if let Some(state) = app.try_state::<AppState>() {
                let tx_opt = state
                    .organize
                    .lock()
                    .ok()
                    .and_then(|s| s.as_ref().map(|j| j.process.stdin_tx.clone()));
                if let Some(tx) = tx_opt {
                    let msg = control_response_error(
                        request_id,
                        "organize job does not handle control_requests".into(),
                    );
                    tokio::spawn(async move {
                        let _ = tx.send(msg).await;
                    });
                }
            }
        }
        DomainEvent::TurnEnd { .. } => {
            let raw = accumulated
                .lock()
                .map(|b| b.clone())
                .unwrap_or_default();
            let parsed = parse_wiki_response(&raw);
            let entries = diff_entries(project_path, &parsed);
            let _ = app.emit(
                "organize:diff",
                serde_json::json!({
                    "project_path": project_path,
                    "files": entries,
                    "raw_chars": raw.chars().count(),
                }),
            );
            // Job is done — drop the slot and kill the child so we don't
            // leave a claude process idling.
            if let Some(state) = app.try_state::<AppState>() {
                if let Ok(mut slot) = state.organize.lock() {
                    if let Some(mut job) = slot.take() {
                        job.process.kill();
                    }
                }
            }
        }
        _ => {}
    }
}

#[tauri::command]
pub async fn organize_notes(app: AppHandle, project_path: String) -> Result<(), String> {
    {
        let state = app.state::<AppState>();
        let slot = state.organize.lock().map_err(|e| e.to_string())?;
        if slot.is_some() {
            return Err("organize already running".into());
        }
    }

    let prompt = build_prompt(&project_path)?;

    let claude_bin = {
        let state = app.state::<AppState>();
        let cfg = state.config.lock().map_err(|e| e.to_string())?;
        cfg.claude_path
            .clone()
            .unwrap_or_else(|| "claude".to_string())
    };

    let accumulated: Arc<Mutex<String>> = Arc::new(Mutex::new(String::new()));

    let app_for_events = app.clone();
    let app_for_stderr = app.clone();
    let app_for_exit = app.clone();
    let project_for_events = project_path.clone();
    let project_for_exit = project_path.clone();
    let accumulated_for_events = accumulated.clone();

    let handle = spawn_claude(
        &claude_bin,
        &project_path,
        None,
        move |ev| {
            handle_organize_event(
                &app_for_events,
                &project_for_events,
                &accumulated_for_events,
                ev,
            );
        },
        move |line| {
            eprintln!("[organize stderr] {line}");
            let _ = app_for_stderr.emit(
                "organize:stderr",
                serde_json::json!({ "line": line }),
            );
        },
        move |_id| {
            // Clear the slot if the process dies before TurnEnd cleared it
            // (e.g. claude crashed or was killed externally). TurnEnd path
            // already cleared the slot; we just emit the exit signal here
            // for the UI to drop its "organizing…" indicator.
            if let Some(state) = app_for_exit.try_state::<AppState>() {
                if let Ok(mut slot) = state.organize.lock() {
                    if slot.is_some() {
                        *slot = None;
                    }
                }
            }
            let _ = app_for_exit.emit(
                "organize:exit",
                serde_json::json!({ "project_path": project_for_exit }),
            );
        },
    )
    .await?;

    let tx = handle.stdin_tx.clone();
    {
        let state = app.state::<AppState>();
        let mut slot = state.organize.lock().map_err(|e| e.to_string())?;
        *slot = Some(OrganizeJob {
            process: handle,
            project_path: project_path.clone(),
            accumulated,
        });
    }

    let msg = user_text_message(prompt);
    tx.send(msg).await.map_err(|e| e.to_string())?;

    let _ = app.emit(
        "organize:start",
        serde_json::json!({ "project_path": project_path }),
    );
    Ok(())
}

#[tauri::command]
pub async fn get_claude_status(app: AppHandle) -> Result<ClaudeStatus, String> {
    let cfg_path: Option<String> = {
        let state = app.state::<AppState>();
        let guard = state.config.lock().map_err(|e| e.to_string())?;
        guard.claude_path.clone()
    };
    let Some(path) = cfg_path.filter(|s| !s.trim().is_empty()) else {
        return Ok(ClaudeStatus {
            path: None,
            ready: false,
            error: None,
        });
    };
    match crate::claude_discovery::validate_claude(&path).await {
        Ok(p) => Ok(ClaudeStatus {
            path: Some(p),
            ready: true,
            error: None,
        }),
        Err(e) => Ok(ClaudeStatus {
            path: Some(path),
            ready: false,
            error: Some(e),
        }),
    }
}

#[tauri::command]
pub fn cancel_organize(app: AppHandle) -> Result<(), String> {
    let state = app.state::<AppState>();
    let project = {
        let mut slot = state.organize.lock().map_err(|e| e.to_string())?;
        if let Some(mut job) = slot.take() {
            let path = job.project_path.clone();
            job.process.kill();
            Some(path)
        } else {
            None
        }
    };
    let _ = app.emit(
        "organize:cancelled",
        serde_json::json!({ "project_path": project }),
    );
    Ok(())
}
