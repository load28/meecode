use crate::config::Config;
use crate::pty_manager::PtyManager;
use crate::session_watcher::SessionWatcher;
use std::sync::Mutex;
use tauri::State;

pub struct AppState {
    pub pty: Mutex<Option<PtyManager>>,
    pub watcher: Mutex<Option<SessionWatcher>>,
    pub config: Mutex<Config>,
}

impl AppState {
    pub fn new() -> Self {
        Self {
            pty: Mutex::new(None),
            watcher: Mutex::new(None),
            config: Mutex::new(Config::load()),
        }
    }
}

#[tauri::command]
pub fn start_session(
    app: tauri::AppHandle,
    state: State<AppState>,
    path: String,
) -> Result<(), String> {
    let config = state.config.lock().map_err(|e| e.to_string())?.clone();
    let claude_cmd = config.claude_path.as_deref().unwrap_or("claude");

    let manager = PtyManager::spawn(app.clone(), claude_cmd, &path)?;
    *state.pty.lock().map_err(|e| e.to_string())? = Some(manager);

    let watcher = SessionWatcher::start(app, &path)?;
    *state.watcher.lock().map_err(|e| e.to_string())? = Some(watcher);

    Ok(())
}

#[tauri::command]
pub fn write_input(text: String, state: State<AppState>) -> Result<(), String> {
    let pty = state.pty.lock().map_err(|e| e.to_string())?;
    match pty.as_ref() {
        Some(manager) => manager.write_input(&text),
        None => Err("PTY session not started".into()),
    }
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

#[tauri::command]
pub fn resize_pty(rows: u16, cols: u16, state: State<AppState>) -> Result<(), String> {
    let pty = state.pty.lock().map_err(|e| e.to_string())?;
    match pty.as_ref() {
        Some(manager) => manager.resize(rows, cols),
        None => Ok(()),
    }
}
