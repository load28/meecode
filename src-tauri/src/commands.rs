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
use crate::bindings::{
    attach as attach_binding, default_bindings_root, detach as detach_binding,
    detach_all_for_task, list_for_session as list_bindings_for_session, Binding,
};
use crate::tasks::organize::{
    count_unprocessed_sources, kickoff_message, prepare_run, spawn_organize_process, OrganizeJob,
};
use crate::tasks::{
    create_source as create_source_fn, create_task as create_task_fn, default_tasks_root,
    delete_source as delete_source_fn, delete_task as delete_task_fn,
    delete_wiki_file as delete_wiki_file_fn, list_sources, list_tasks as list_tasks_fn,
    list_wiki_files as list_wiki_files_fn, read_organize_session, read_task,
    read_wiki_file as read_wiki_file_fn, update_task as update_task_fn,
    write_wiki_file as write_wiki_file_fn, Source, SourceOrigin, Task, TaskSummary, WikiFile,
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

/// One-slot-per-task organize job registry. Concurrent organize for
/// *different* tasks is fine; double-clicking the same task while it's
/// running errors out so we don't race two Claude processes against the
/// same wiki dir.
pub type OrganizeSlot = Arc<Mutex<Option<OrganizeJob>>>;

pub struct AppState {
    pub tabs: Mutex<HashMap<String, TabHandle>>,
    pub config: Mutex<Config>,
    pub organize_jobs: Mutex<HashMap<String, OrganizeSlot>>,
    /// One live recursive file watcher + directory cache per opened project
    /// root, keyed by absolute root path. See `file_watch`.
    pub watched: Mutex<HashMap<String, Arc<crate::file_watch::WatchedProject>>>,
}

impl AppState {
    pub fn new() -> Self {
        Self {
            tabs: Mutex::new(HashMap::new()),
            config: Mutex::new(Config::load()),
            organize_jobs: Mutex::new(HashMap::new()),
            watched: Mutex::new(HashMap::new()),
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
    /// Optional user-authored message accompanying a denial — when present
    /// this replaces the default "User denied" string sent back to Claude
    /// so the model knows what to do differently next time.
    #[serde(default)]
    pub denial_message: Option<String>,
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

/// One entry in a directory listing for the file-explorer tree.
#[derive(serde::Serialize, Clone)]
pub struct DirEntry {
    pub name: String,
    pub path: String,
    pub is_dir: bool,
}

/// Reads the immediate children of `path`, directories first then
/// case-insensitive name order — the ordering IDE file trees conventionally
/// use. Everything is returned (including dotfiles and heavy dirs like
/// `node_modules`); the UI never filters. Shared by `list_dir` and the file
/// watcher's cache reconciliation.
pub fn read_dir_entries(path: &str) -> Result<Vec<DirEntry>, String> {
    use std::cmp::Ordering;
    use std::fs;

    let meta = fs::metadata(path).map_err(|e| format!("metadata: {e}"))?;
    if !meta.is_dir() {
        return Err("not a directory".into());
    }
    let read = fs::read_dir(path).map_err(|e| format!("read_dir: {e}"))?;
    let mut out: Vec<DirEntry> = Vec::new();
    for entry in read.flatten() {
        let is_dir = entry.file_type().map(|t| t.is_dir()).unwrap_or(false);
        out.push(DirEntry {
            name: entry.file_name().to_string_lossy().to_string(),
            path: entry.path().to_string_lossy().to_string(),
            is_dir,
        });
    }
    out.sort_by(|a, b| match (a.is_dir, b.is_dir) {
        (true, false) => Ordering::Less,
        (false, true) => Ordering::Greater,
        _ => a.name.to_lowercase().cmp(&b.name.to_lowercase()),
    });
    Ok(out)
}

/// Basename of a path string, for building a `DirEntry` after a mutation.
fn file_name_of(path: &str) -> String {
    std::path::Path::new(path)
        .file_name()
        .map(|s| s.to_string_lossy().to_string())
        .unwrap_or_else(|| path.to_string())
}

fn entry_for(path: &str, is_dir: bool) -> DirEntry {
    DirEntry {
        name: file_name_of(path),
        path: path.to_string(),
        is_dir,
    }
}

/// Creates an empty file or a directory at `path`, mirroring VS Code's
/// New File / New Folder actions (`NewFileAction` / `NewFolderAction`): the
/// entry is written to disk and the explorer's file watcher surfaces it. Any
/// missing parent directories are created too, so typing a nested name like
/// `a/b/c.ts` works just as it does in VS Code's inline new-file input. Errors
/// if the target already exists so an existing file is never clobbered.
#[tauri::command]
pub fn create_entry(path: String, is_dir: bool) -> Result<DirEntry, String> {
    use std::fs;
    let p = std::path::Path::new(&path);
    if p.exists() {
        return Err(format!("이미 존재합니다: {}", file_name_of(&path)));
    }
    if is_dir {
        fs::create_dir_all(p).map_err(|e| format!("create_dir: {e}"))?;
    } else {
        if let Some(parent) = p.parent() {
            fs::create_dir_all(parent).map_err(|e| format!("create_dir: {e}"))?;
        }
        fs::File::create(p).map_err(|e| format!("create_file: {e}"))?;
    }
    Ok(entry_for(&path, is_dir))
}

/// Renames or moves `from` → `to`. VS Code performs both rename and
/// drag-and-drop move through a single `IFileService.move`; we likewise back
/// both with one `fs::rename`. Guards mirror VS Code's drop validation: it
/// refuses to overwrite an existing destination and refuses to move a
/// directory into itself or one of its own descendants.
#[tauri::command]
pub fn rename_entry(from: String, to: String) -> Result<DirEntry, String> {
    use std::fs;
    let src = std::path::Path::new(&from);
    let dst = std::path::Path::new(&to);
    if !src.exists() {
        return Err("원본을 찾을 수 없습니다.".into());
    }
    if src == dst {
        return Ok(entry_for(&to, src.is_dir()));
    }
    // Component-wise prefix check: blocks moving /a/b into /a/b/c without
    // false-positives on a mere string prefix like /a/b → /a/bc.
    if dst.starts_with(src) {
        return Err("폴더를 자기 자신의 하위로 이동할 수 없습니다.".into());
    }
    if dst.exists() {
        return Err(format!("이미 존재합니다: {}", file_name_of(&to)));
    }
    let is_dir = src.is_dir();
    fs::rename(src, dst).map_err(|e| format!("rename: {e}"))?;
    Ok(entry_for(&to, is_dir))
}

/// Deletes a file or directory (recursively for directories), backing VS
/// Code's `DeleteFileAction`. VS Code defaults to moving the entry to the OS
/// trash; we delete permanently and rely on the explorer's confirmation
/// prompt (VS Code's `explorer.confirmDelete`) to guard the action. Uses
/// `symlink_metadata` so a symlinked directory is unlinked, not followed.
#[tauri::command]
pub fn delete_entry(path: String) -> Result<(), String> {
    use std::fs;
    let p = std::path::Path::new(&path);
    let meta = fs::symlink_metadata(p).map_err(|e| format!("metadata: {e}"))?;
    if meta.is_dir() {
        fs::remove_dir_all(p).map_err(|e| format!("remove_dir: {e}"))?;
    } else {
        fs::remove_file(p).map_err(|e| format!("remove_file: {e}"))?;
    }
    Ok(())
}

/// Lists the immediate children of `path` for the file explorer. When `root`
/// names a project with a live watcher (see `file_watch`), the result is
/// served read-through from that project's in-memory cache — so re-expanding a
/// folder is instant and always reflects the latest watcher state. `refresh`
/// forces a fresh disk read (the explorer's ↻ button). Without a watched
/// `root` it falls back to a direct disk read.
#[tauri::command]
pub fn list_dir(
    app: AppHandle,
    path: String,
    root: Option<String>,
    refresh: Option<bool>,
) -> Result<Vec<DirEntry>, String> {
    if let Some(root) = root.filter(|s| !s.is_empty()) {
        if let Some(project) = crate::file_watch::get_project(&app, &root) {
            return crate::file_watch::cached_list_dir(&project, &path, refresh.unwrap_or(false));
        }
    }
    read_dir_entries(&path)
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

#[tauri::command]
pub fn list_tasks() -> Result<Vec<TaskSummary>, String> {
    list_tasks_fn(&default_tasks_root())
}

#[derive(Deserialize)]
pub struct CreateTaskArgs {
    pub name: String,
    #[serde(default)]
    pub description: Option<String>,
}

#[tauri::command]
pub fn create_task(args: CreateTaskArgs) -> Result<Task, String> {
    create_task_fn(
        &default_tasks_root(),
        args.name,
        args.description.unwrap_or_default(),
    )
}

#[tauri::command]
pub fn get_task(task_id: String) -> Result<Task, String> {
    read_task(&default_tasks_root(), &task_id)
}

#[derive(Deserialize)]
pub struct UpdateTaskArgs {
    pub task_id: String,
    #[serde(default)]
    pub name: Option<String>,
    #[serde(default)]
    pub description: Option<String>,
}

#[tauri::command]
pub fn update_task(args: UpdateTaskArgs) -> Result<Task, String> {
    update_task_fn(&default_tasks_root(), &args.task_id, args.name, args.description)
}

#[tauri::command]
pub fn delete_task(task_id: String) -> Result<(), String> {
    // Drop the bindings first so the Task can't briefly appear "still
    // attached" in a UI that polls bindings between these two steps.
    let _ = detach_all_for_task(&default_bindings_root(), &task_id);
    delete_task_fn(&default_tasks_root(), &task_id)
}

#[tauri::command]
pub fn list_task_sources(task_id: String) -> Result<Vec<Source>, String> {
    list_sources(&default_tasks_root(), &task_id)
}

#[derive(Deserialize)]
pub struct CreateSourceArgs {
    pub task_id: String,
    pub kind: String,
    #[serde(default)]
    pub title: String,
    pub content: String,
    #[serde(default)]
    pub session_id: Option<String>,
    #[serde(default)]
    pub qa_id: Option<String>,
    #[serde(default)]
    pub project_path: Option<String>,
}

#[tauri::command]
pub fn create_source(args: CreateSourceArgs) -> Result<Source, String> {
    let origin = SourceOrigin {
        session_id: args.session_id,
        qa_id: args.qa_id,
        project_path: args.project_path,
    };
    create_source_fn(
        &default_tasks_root(),
        &args.task_id,
        args.kind,
        args.title,
        args.content,
        origin,
    )
}

#[derive(Deserialize)]
pub struct DeleteSourceArgs {
    pub task_id: String,
    pub source_id: String,
}

#[tauri::command]
pub fn delete_source(args: DeleteSourceArgs) -> Result<(), String> {
    delete_source_fn(&default_tasks_root(), &args.task_id, &args.source_id)
}

#[derive(Deserialize)]
pub struct BindingArgs {
    pub session_id: String,
    pub task_id: String,
}

#[tauri::command]
pub fn attach_task(args: BindingArgs) -> Result<Binding, String> {
    attach_binding(&default_bindings_root(), args.session_id, args.task_id)
}

#[tauri::command]
pub fn detach_task(args: BindingArgs) -> Result<(), String> {
    detach_binding(&default_bindings_root(), &args.session_id, &args.task_id)
}

#[tauri::command]
pub fn list_session_task_bindings(session_id: String) -> Result<Vec<Binding>, String> {
    list_bindings_for_session(&default_bindings_root(), &session_id)
}

// ── Wiki ───────────────────────────────────────────────────────────────

#[tauri::command]
pub fn list_task_wiki_files(task_id: String) -> Result<Vec<WikiFile>, String> {
    list_wiki_files_fn(&default_tasks_root(), &task_id)
}

#[derive(Deserialize)]
pub struct WikiNameArgs {
    pub task_id: String,
    pub name: String,
}

#[tauri::command]
pub fn read_task_wiki(args: WikiNameArgs) -> Result<String, String> {
    read_wiki_file_fn(&default_tasks_root(), &args.task_id, &args.name)
}

#[derive(Deserialize)]
pub struct WriteWikiArgs {
    pub task_id: String,
    pub name: String,
    pub content: String,
}

#[tauri::command]
pub fn write_task_wiki(args: WriteWikiArgs) -> Result<(), String> {
    write_wiki_file_fn(
        &default_tasks_root(),
        &args.task_id,
        &args.name,
        &args.content,
    )
}

#[tauri::command]
pub fn delete_task_wiki(args: WikiNameArgs) -> Result<(), String> {
    delete_wiki_file_fn(&default_tasks_root(), &args.task_id, &args.name)
}

// ── Organize ───────────────────────────────────────────────────────────

#[derive(serde::Serialize)]
pub struct OrganizePreview {
    pub task_id: String,
    pub unprocessed_count: u64,
    /// Persisted Claude session id for this task's organize loop, if any.
    pub resume_session_id: Option<String>,
}

#[tauri::command]
pub fn get_organize_preview(task_id: String) -> Result<OrganizePreview, String> {
    let root = default_tasks_root();
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

#[tauri::command]
pub async fn start_task_organize(app: AppHandle, task_id: String) -> Result<(), String> {
    let tasks_root = default_tasks_root();
    let bindings_root = default_bindings_root();

    // Grab or create the per-task slot, check it isn't already running.
    let slot: OrganizeSlot = {
        let state = app.state::<AppState>();
        let mut jobs = state.organize_jobs.lock().map_err(|e| e.to_string())?;
        let s = jobs
            .entry(task_id.clone())
            .or_insert_with(|| Arc::new(Mutex::new(None)))
            .clone();
        // Quick non-blocking check — keep the registry lock short.
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

    let claude_bin = {
        let state = app.state::<AppState>();
        let cfg = state.config.lock().map_err(|e| e.to_string())?;
        cfg.claude_path
            .clone()
            .filter(|s| !s.trim().is_empty())
            .ok_or_else(|| "claude_path가 설정되지 않았습니다.".to_string())?
    };

    let resume_session = read_organize_session(&tasks_root, &task_id)
        .ok()
        .flatten()
        .map(|m| m.session_id);

    let source_ids: Vec<String> = prepared.pending.iter().map(|s| s.id.clone()).collect();

    let _ = app.emit(
        "organize:start",
        serde_json::json!({
            "task_id": task_id,
            "source_count": source_ids.len(),
        }),
    );

    let handle = spawn_organize_process(
        app.clone(),
        claude_bin,
        tasks_root,
        bindings_root,
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

    tx.send(kickoff_message(prepared.prompt))
        .await
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn cancel_task_organize(app: AppHandle, task_id: String) -> Result<(), String> {
    let state = app.state::<AppState>();
    let slot = {
        let jobs = state.organize_jobs.lock().map_err(|e| e.to_string())?;
        jobs.get(&task_id).cloned()
    };
    if let Some(slot) = slot {
        let mut guard = slot.lock().map_err(|e| e.to_string())?;
        if let Some(mut job) = guard.take() {
            job.process.kill();
        }
    }
    let _ = app.emit(
        "organize:cancelled",
        serde_json::json!({ "task_id": task_id }),
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

