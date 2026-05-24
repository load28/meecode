//! Project file watching + directory cache for the file explorer.
//!
//! Mirrors how VS Code keeps its Explorer responsive: one recursive native
//! watcher per opened workspace folder (parcel-watcher there → the `notify`
//! crate here, the same library rust-analyzer uses, backed by FSEvents /
//! inotify / ReadDirectoryChangesW). Raw OS events are coalesced and
//! debounced (`notify-debouncer-full`, which stitches renames and collapses a
//! recursive directory delete into a single event), then reconciled against an
//! in-memory cache. Only directories the user has actually loaded are
//! re-read — VS Code's ExplorerModel reconciles just the affected, already
//! materialised nodes rather than rebuilding the tree. The tree itself stays
//! lazy: children are read on first expand and cached here, so re-expanding is
//! instant and always reflects the latest watcher state.

use crate::commands::{read_dir_entries, AppState, DirEntry};
use notify_debouncer_full::{
    new_debouncer,
    notify::{event::ModifyKind, EventKind, RecommendedWatcher, RecursiveMode},
    DebounceEventResult, DebouncedEvent, Debouncer, RecommendedCache,
};
use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager};

/// How long to collect raw OS events before emitting a coalesced batch.
/// Short enough to feel live, long enough to fold a burst (e.g. a git
/// checkout or `npm install`) into one reconciliation pass.
const DEBOUNCE_MS: u64 = 250;

/// Heavy / noisy directories whose events we drop, modelled on VS Code's
/// default `files.watcherExclude`. The tree still *shows* these folders (read
/// lazily on expand, exactly like VS Code); we just don't let their churn
/// invalidate the cache or wake the UI.
const EXCLUDED_DIR_NAMES: &[&str] = &[
    ".git",
    "node_modules",
    ".hg",
    ".svn",
    "CVS",
    ".DS_Store",
    "bower_components",
    "target",
    "dist",
    ".next",
    ".cache",
    ".turbo",
];

type DirCache = HashMap<PathBuf, Vec<DirEntry>>;

/// A project's live watcher plus its directory cache. Dropping this stops the
/// watcher (the debouncer halts on drop).
pub struct WatchedProject {
    cache: Arc<Mutex<DirCache>>,
    _debouncer: Debouncer<RecommendedWatcher, RecommendedCache>,
}

/// True if any path component between `root` and `path` is an excluded dir.
fn is_excluded(root: &Path, path: &Path) -> bool {
    match path.strip_prefix(root) {
        Ok(rel) => rel.components().any(|c| {
            c.as_os_str()
                .to_str()
                .map(|s| EXCLUDED_DIR_NAMES.contains(&s))
                .unwrap_or(false)
        }),
        Err(_) => false,
    }
}

/// Whether an event can change a directory's *child set*. Pure content or
/// metadata writes (the common "save file" case) leave listings untouched, so
/// we skip them to avoid needless re-reads.
fn affects_listing(kind: &EventKind) -> bool {
    !matches!(
        kind,
        EventKind::Access(_)
            | EventKind::Modify(ModifyKind::Data(_))
            | EventKind::Modify(ModifyKind::Metadata(_))
    )
}

/// Reconcile a debounced batch against the cache, then push the delta to the
/// UI. Runs on the watcher's background thread.
fn handle_events(
    app: &AppHandle,
    root: &Path,
    cache: &Arc<Mutex<DirCache>>,
    events: Vec<DebouncedEvent>,
) {
    // A change to `foo/bar` alters the listing of its parent `foo`; a
    // rename/remove of `foo/bar` itself matters when `bar` is a loaded dir.
    let mut candidates: HashSet<PathBuf> = HashSet::new();
    for ev in &events {
        if !affects_listing(&ev.kind) {
            continue;
        }
        for path in &ev.paths {
            if is_excluded(root, path) {
                continue;
            }
            if let Some(parent) = path.parent() {
                candidates.insert(parent.to_path_buf());
            }
            candidates.insert(path.clone());
        }
    }
    if candidates.is_empty() {
        return;
    }

    let mut updated: Vec<serde_json::Value> = Vec::new();
    let mut removed: Vec<String> = Vec::new();
    {
        let mut guard = match cache.lock() {
            Ok(g) => g,
            Err(_) => return,
        };
        // Only directories the user has loaded are in the cache, and only
        // those need reconciling — everything else is re-read lazily on its
        // next expand.
        let relevant: Vec<PathBuf> = candidates
            .into_iter()
            .filter(|p| guard.contains_key(p))
            .collect();
        for dir in relevant {
            let dir_str = dir.to_string_lossy().to_string();
            match read_dir_entries(&dir_str) {
                Ok(entries) => {
                    guard.insert(dir.clone(), entries.clone());
                    updated.push(serde_json::json!({ "dir": dir_str, "entries": entries }));
                }
                Err(_) => {
                    // The directory is gone: drop it and every cached
                    // descendant so re-expanding starts fresh.
                    let stale: Vec<PathBuf> =
                        guard.keys().filter(|k| k.starts_with(&dir)).cloned().collect();
                    for k in stale {
                        guard.remove(&k);
                    }
                    removed.push(dir_str);
                }
            }
        }
    }

    if updated.is_empty() && removed.is_empty() {
        return;
    }
    let _ = app.emit(
        "project_fs:changed",
        serde_json::json!({
            "root": root.to_string_lossy(),
            "updated": updated,
            "removed": removed,
        }),
    );
}

/// Look up an already-watched project by root path.
pub fn get_project(app: &AppHandle, root: &str) -> Option<Arc<WatchedProject>> {
    let state = app.state::<AppState>();
    let guard = state.watched.lock().ok()?;
    guard.get(root).cloned()
}

/// Read-through cache for a directory listing. Returns the cached entries when
/// present (and `refresh` is false), otherwise reads disk and caches the
/// result.
pub fn cached_list_dir(
    project: &WatchedProject,
    path: &str,
    refresh: bool,
) -> Result<Vec<DirEntry>, String> {
    let key = PathBuf::from(path);
    if !refresh {
        if let Ok(guard) = project.cache.lock() {
            if let Some(hit) = guard.get(&key) {
                return Ok(hit.clone());
            }
        }
    }
    let entries = read_dir_entries(path)?;
    if let Ok(mut guard) = project.cache.lock() {
        guard.insert(key, entries.clone());
    }
    Ok(entries)
}

/// Start watching `root` (idempotent) and return its root listing. Subsequent
/// directory reads should go through `list_dir` with the same `root` so they
/// hit the cache this primes.
#[tauri::command]
pub fn watch_project(app: AppHandle, root: String) -> Result<Vec<DirEntry>, String> {
    let root_path = PathBuf::from(&root);
    if !root_path.is_dir() {
        return Err("not a directory".into());
    }
    if let Some(project) = get_project(&app, &root) {
        return cached_list_dir(&project, &root, false);
    }

    let cache: Arc<Mutex<DirCache>> = Arc::new(Mutex::new(HashMap::new()));
    let app_cb = app.clone();
    let root_cb = root_path.clone();
    let cache_cb = cache.clone();
    let mut debouncer = new_debouncer(
        Duration::from_millis(DEBOUNCE_MS),
        None,
        move |res: DebounceEventResult| {
            if let Ok(events) = res {
                handle_events(&app_cb, &root_cb, &cache_cb, events);
            }
        },
    )
    .map_err(|e| format!("watcher init: {e}"))?;
    debouncer
        .watch(root_path.as_path(), RecursiveMode::Recursive)
        .map_err(|e| format!("watch: {e}"))?;

    let project = Arc::new(WatchedProject {
        cache,
        _debouncer: debouncer,
    });
    {
        let state = app.state::<AppState>();
        let mut guard = state.watched.lock().map_err(|e| e.to_string())?;
        // A concurrent call may have inserted first; if so its watcher wins
        // and ours is dropped (stopping the duplicate watcher).
        guard.entry(root.clone()).or_insert(project);
    }
    let project = get_project(&app, &root).ok_or("watch registry race")?;
    cached_list_dir(&project, &root, true)
}

#[cfg(test)]
mod tests {
    use super::*;
    use notify_debouncer_full::notify::event::{
        AccessKind, CreateKind, DataChange, MetadataKind, RemoveKind, RenameMode,
    };

    #[test]
    fn excludes_heavy_dirs_anywhere_under_root() {
        let root = Path::new("/proj");
        assert!(is_excluded(root, Path::new("/proj/node_modules/react/index.js")));
        assert!(is_excluded(root, Path::new("/proj/src/.git/HEAD")));
        assert!(is_excluded(root, Path::new("/proj/target/debug/app")));
    }

    #[test]
    fn keeps_normal_paths_and_paths_outside_root() {
        let root = Path::new("/proj");
        assert!(!is_excluded(root, Path::new("/proj/src/main.rs")));
        // A file merely *named* like an excluded dir is not excluded.
        assert!(!is_excluded(root, Path::new("/proj/node_modules.txt")));
        // Paths outside the watched root are never excluded here.
        assert!(!is_excluded(root, Path::new("/other/node_modules/x")));
    }

    #[test]
    fn structural_events_affect_listing() {
        assert!(affects_listing(&EventKind::Create(CreateKind::File)));
        assert!(affects_listing(&EventKind::Remove(RemoveKind::Folder)));
        assert!(affects_listing(&EventKind::Modify(ModifyKind::Name(
            RenameMode::Both
        ))));
    }

    #[test]
    fn content_and_metadata_writes_are_ignored() {
        assert!(!affects_listing(&EventKind::Modify(ModifyKind::Data(
            DataChange::Content
        ))));
        assert!(!affects_listing(&EventKind::Modify(ModifyKind::Metadata(
            MetadataKind::WriteTime
        ))));
        assert!(!affects_listing(&EventKind::Access(AccessKind::Read)));
    }
}
