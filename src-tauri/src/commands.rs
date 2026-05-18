use crate::config::Config;
use std::sync::Mutex;
use tauri::State;

pub struct AppState {
    pub config: Mutex<Config>,
}

impl AppState {
    pub fn new() -> Self {
        Self {
            config: Mutex::new(Config::load()),
        }
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
