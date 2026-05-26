//! Process-global singletons replacing Tauri's managed `State<T>` injection.
//! The sidecar is a single process, so one instance of each lives for its
//! lifetime (the per-field `Mutex`es preserve the original concurrency model).

use std::sync::{Mutex, OnceLock};

use crate::config::Config;
use crate::lsp::LspState;
use crate::open_files::OpenFilesState;

static CONFIG: OnceLock<Mutex<Config>> = OnceLock::new();
static LSP: OnceLock<LspState> = OnceLock::new();
static OPEN_FILES: OnceLock<OpenFilesState> = OnceLock::new();

fn config_store() -> &'static Mutex<Config> {
    CONFIG.get_or_init(|| Mutex::new(Config::load()))
}

pub fn lsp() -> &'static LspState {
    LSP.get_or_init(LspState::default)
}

pub fn open_files() -> &'static OpenFilesState {
    OPEN_FILES.get_or_init(OpenFilesState::default)
}

pub fn get_config() -> Result<Config, String> {
    config_store()
        .lock()
        .map(|g| g.clone())
        .map_err(|e| e.to_string())
}

pub fn set_config(config: Config) -> Result<(), String> {
    {
        let mut guard = config_store().lock().map_err(|e| e.to_string())?;
        *guard = config.clone();
    }
    config.save()
}
