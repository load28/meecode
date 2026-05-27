//! Process-global singletons replacing Tauri's managed `State<T>` injection.
//! The sidecar is a single process, so one instance of each lives for its
//! lifetime (the per-field `Mutex`es preserve the original concurrency model).

use std::collections::HashMap;
use std::sync::{Arc, Mutex, OnceLock};

use crate::config::Config;
use crate::file_watch::WatchedProject;
use crate::lsp::LspState;
use crate::open_files::OpenFilesState;
use crate::session::TabHandle;
use crate::tasks::distill::HarvestSlot;
use crate::tasks::organize::OrganizeSlot;

static CONFIG: OnceLock<Mutex<Config>> = OnceLock::new();
static LSP: OnceLock<LspState> = OnceLock::new();
static OPEN_FILES: OnceLock<OpenFilesState> = OnceLock::new();
static WATCHED: OnceLock<Mutex<HashMap<String, Arc<WatchedProject>>>> = OnceLock::new();
static TABS: OnceLock<Mutex<HashMap<String, TabHandle>>> = OnceLock::new();
static ORGANIZE_JOBS: OnceLock<Mutex<HashMap<String, OrganizeSlot>>> = OnceLock::new();
static HARVEST_JOBS: OnceLock<Mutex<HashMap<String, HarvestSlot>>> = OnceLock::new();

fn config_store() -> &'static Mutex<Config> {
    CONFIG.get_or_init(|| Mutex::new(Config::load()))
}

pub fn lsp() -> &'static LspState {
    LSP.get_or_init(LspState::default)
}

pub fn open_files() -> &'static OpenFilesState {
    OPEN_FILES.get_or_init(OpenFilesState::default)
}

/// Registry of live per-project file watchers, keyed by root path.
pub fn watched() -> &'static Mutex<HashMap<String, Arc<WatchedProject>>> {
    WATCHED.get_or_init(|| Mutex::new(HashMap::new()))
}

/// Registry of per-tab Claude sessions, keyed by tab id.
pub fn tabs() -> &'static Mutex<HashMap<String, TabHandle>> {
    TABS.get_or_init(|| Mutex::new(HashMap::new()))
}

/// One-slot-per-task organize job registry.
pub fn organize_jobs() -> &'static Mutex<HashMap<String, OrganizeSlot>> {
    ORGANIZE_JOBS.get_or_init(|| Mutex::new(HashMap::new()))
}

/// One-slot-per-task session-harvest job registry.
pub fn harvest_jobs() -> &'static Mutex<HashMap<String, HarvestSlot>> {
    HARVEST_JOBS.get_or_init(|| Mutex::new(HashMap::new()))
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
