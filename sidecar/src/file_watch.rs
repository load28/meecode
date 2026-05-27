//! Project file watching + directory cache for the file explorer (ported from
//! the Tauri lib, tauri-free). One recursive `notify` watcher per opened
//! workspace folder; raw OS events are debounced, then reconciled against an
//! in-memory cache. Only directories the user has loaded are re-read; the tree
//! stays lazy. Deltas are pushed to the host as `project_fs:changed`.

use crate::bridge::emit_event;
use crate::files::{read_dir_entries, DirEntry};
use notify_debouncer_full::{
    new_debouncer,
    notify::{
        event::{ModifyKind, RenameMode},
        EventKind, RecommendedWatcher, RecursiveMode,
    },
    DebounceEventResult, DebouncedEvent, Debouncer, RecommendedCache,
};
use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::Duration;

const DEBOUNCE_MS: u64 = 250;

/// Heavy / noisy directories whose events we drop (modelled on VS Code's
/// default `files.watcherExclude`). The tree still shows these folders (read
/// lazily on expand); we just don't let their churn invalidate the cache.
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

fn affects_listing(kind: &EventKind) -> bool {
    !matches!(
        kind,
        EventKind::Access(_)
            | EventKind::Modify(ModifyKind::Data(_))
            | EventKind::Modify(ModifyKind::Metadata(_))
    )
}

/// Re-root `key` from under `from` to under `to`, preserving the suffix.
/// Component-wise, so `/a/x` never matches `/a/xy`.
fn remap_key(from: &Path, to: &Path, key: &Path) -> Option<PathBuf> {
    key.strip_prefix(from).ok().map(|rel| to.join(rel))
}

/// Re-read each directory in `dirs` and record the delta: a fresh listing
/// (`updated`) if it still exists, else drop it and every cached descendant.
fn reconcile_dirs(
    guard: &mut DirCache,
    dirs: Vec<PathBuf>,
    updated: &mut Vec<serde_json::Value>,
    removed: &mut Vec<String>,
) {
    for dir in dirs {
        if !guard.contains_key(&dir) {
            continue;
        }
        let dir_str = dir.to_string_lossy().to_string();
        match read_dir_entries(&dir_str) {
            Ok(entries) => {
                guard.insert(dir.clone(), entries.clone());
                updated.push(serde_json::json!({ "dir": dir_str, "entries": entries }));
            }
            Err(_) => {
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

fn emit_changes(
    root: &Path,
    updated: Vec<serde_json::Value>,
    removed: Vec<String>,
    renamed: Vec<serde_json::Value>,
) {
    if updated.is_empty() && removed.is_empty() && renamed.is_empty() {
        return;
    }
    emit_event(
        "project_fs:changed",
        serde_json::json!({
            "root": root.to_string_lossy(),
            "updated": updated,
            "removed": removed,
            "renamed": renamed,
        }),
    );
}

/// Re-read every loaded directory from scratch (queue overflow / watcher error).
fn resync_all(root: &Path, cache: &Arc<Mutex<DirCache>>) {
    let mut updated: Vec<serde_json::Value> = Vec::new();
    let mut removed: Vec<String> = Vec::new();
    {
        let mut guard = match cache.lock() {
            Ok(g) => g,
            Err(_) => return,
        };
        let dirs: Vec<PathBuf> = guard.keys().cloned().collect();
        reconcile_dirs(&mut guard, dirs, &mut updated, &mut removed);
    }
    emit_changes(root, updated, removed, Vec::new());
}

/// Reconcile a debounced batch against the cache, then push the delta. Stitched
/// atomic moves (`Modify(Name(Both))`) re-root the cached subtree instead of
/// dropping it, so a renamed/moved folder keeps its loaded children.
fn handle_events(root: &Path, cache: &Arc<Mutex<DirCache>>, events: Vec<DebouncedEvent>) {
    let rescan = events.iter().any(|ev| ev.need_rescan());

    let mut renames: Vec<(PathBuf, PathBuf)> = Vec::new();
    let mut candidates: HashSet<PathBuf> = HashSet::new();
    let note = |set: &mut HashSet<PathBuf>, path: &Path| {
        if is_excluded(root, path) {
            return;
        }
        if let Some(parent) = path.parent() {
            set.insert(parent.to_path_buf());
        }
        set.insert(path.to_path_buf());
    };
    for ev in &events {
        if matches!(ev.kind, EventKind::Modify(ModifyKind::Name(RenameMode::Both)))
            && ev.paths.len() == 2
        {
            let (from, to) = (&ev.paths[0], &ev.paths[1]);
            renames.push((from.clone(), to.clone()));
            note(&mut candidates, from);
            note(&mut candidates, to);
            continue;
        }
        if !affects_listing(&ev.kind) {
            continue;
        }
        for path in &ev.paths {
            note(&mut candidates, path);
        }
    }
    if !rescan && renames.is_empty() && candidates.is_empty() {
        return;
    }

    let mut updated: Vec<serde_json::Value> = Vec::new();
    let mut removed: Vec<String> = Vec::new();
    let mut renamed: Vec<serde_json::Value> = Vec::new();
    {
        let mut guard = match cache.lock() {
            Ok(g) => g,
            Err(_) => return,
        };

        let mut handled: HashSet<PathBuf> = HashSet::new();
        let mut moved_from: Vec<PathBuf> = Vec::new();
        for (from, to) in &renames {
            if is_excluded(root, from) || is_excluded(root, to) {
                continue;
            }
            let subtree: Vec<PathBuf> = guard
                .keys()
                .filter(|k| remap_key(from, to, k).is_some())
                .cloned()
                .collect();
            if subtree.is_empty() {
                continue;
            }
            for old_key in subtree {
                let Some(new_key) = remap_key(from, to, &old_key) else {
                    continue;
                };
                guard.remove(&old_key);
                let new_str = new_key.to_string_lossy().to_string();
                if let Ok(entries) = read_dir_entries(&new_str) {
                    guard.insert(new_key.clone(), entries.clone());
                    updated.push(serde_json::json!({ "dir": new_str, "entries": entries }));
                    handled.insert(new_key);
                }
            }
            renamed.push(serde_json::json!({
                "from": from.to_string_lossy(),
                "to": to.to_string_lossy(),
            }));
            moved_from.push(from.clone());
        }

        let scope: Vec<PathBuf> = if rescan {
            guard.keys().cloned().collect()
        } else {
            candidates.into_iter().collect()
        };
        let dirs: Vec<PathBuf> = scope
            .into_iter()
            .filter(|p| guard.contains_key(p))
            .filter(|p| !handled.contains(p))
            .filter(|p| !moved_from.iter().any(|f| p.starts_with(f)))
            .collect();
        reconcile_dirs(&mut guard, dirs, &mut updated, &mut removed);
    }

    emit_changes(root, updated, removed, renamed);
}

/// Look up an already-watched project by root path.
pub fn get_project(root: &str) -> Option<Arc<WatchedProject>> {
    let guard = crate::state::watched().lock().ok()?;
    guard.get(root).cloned()
}

/// Read-through cache for a directory listing.
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

/// Lists `path`'s children, served read-through from a watched `root`'s cache
/// when available, else a direct disk read.
pub fn list_dir(
    path: String,
    root: Option<String>,
    refresh: Option<bool>,
) -> Result<Vec<DirEntry>, String> {
    if let Some(root) = root.filter(|s| !s.is_empty()) {
        if let Some(project) = get_project(&root) {
            return cached_list_dir(&project, &path, refresh.unwrap_or(false));
        }
    }
    read_dir_entries(&path)
}

/// Start watching `root` (idempotent) and return its root listing.
pub fn watch_project(root: String) -> Result<Vec<DirEntry>, String> {
    let root_path = PathBuf::from(&root);
    if !root_path.is_dir() {
        return Err("not a directory".into());
    }
    if let Some(project) = get_project(&root) {
        return cached_list_dir(&project, &root, false);
    }

    let cache: Arc<Mutex<DirCache>> = Arc::new(Mutex::new(HashMap::new()));
    let root_cb = root_path.clone();
    let cache_cb = cache.clone();
    let mut debouncer = new_debouncer(
        Duration::from_millis(DEBOUNCE_MS),
        None,
        move |res: DebounceEventResult| match res {
            Ok(events) => handle_events(&root_cb, &cache_cb, events),
            Err(_) => resync_all(&root_cb, &cache_cb),
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
        let mut guard = crate::state::watched().lock().map_err(|e| e.to_string())?;
        guard.entry(root.clone()).or_insert(project);
    }
    let project = get_project(&root).ok_or("watch registry race")?;
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
        assert!(!is_excluded(root, Path::new("/proj/node_modules.txt")));
        assert!(!is_excluded(root, Path::new("/other/node_modules/x")));
    }

    #[test]
    fn structural_events_affect_listing() {
        assert!(affects_listing(&EventKind::Create(CreateKind::File)));
        assert!(affects_listing(&EventKind::Remove(RemoveKind::Folder)));
        assert!(affects_listing(&EventKind::Modify(ModifyKind::Name(RenameMode::Both))));
    }

    #[test]
    fn remap_reroots_subtree_and_ignores_siblings() {
        let from = Path::new("/proj/src");
        let to = Path::new("/proj/app");
        assert_eq!(remap_key(from, to, Path::new("/proj/src")), Some(to.into()));
        assert_eq!(
            remap_key(from, to, Path::new("/proj/src/utils")),
            Some(PathBuf::from("/proj/app/utils"))
        );
        assert_eq!(remap_key(from, to, Path::new("/proj/src-old")), None);
        assert_eq!(remap_key(from, to, Path::new("/proj/lib")), None);
    }

    #[test]
    fn reconcile_refreshes_survivors_and_drops_deleted() {
        use std::fs;
        use tempfile::tempdir;
        let tmp = tempdir().unwrap();
        let root = tmp.path();
        fs::create_dir(root.join("keep")).unwrap();
        fs::create_dir(root.join("gone")).unwrap();

        let mut cache: DirCache = HashMap::new();
        cache.insert(root.to_path_buf(), Vec::new());
        cache.insert(root.join("keep"), Vec::new());
        cache.insert(root.join("gone"), Vec::new());

        fs::write(root.join("keep/new.txt"), b"x").unwrap();
        fs::remove_dir(root.join("gone")).unwrap();

        let mut updated = Vec::new();
        let mut removed = Vec::new();
        let dirs: Vec<PathBuf> = cache.keys().cloned().collect();
        reconcile_dirs(&mut cache, dirs, &mut updated, &mut removed);

        assert!(cache[&root.join("keep")].iter().any(|e| e.name == "new.txt"));
        assert!(!cache.contains_key(&root.join("gone")));
        assert!(removed.iter().any(|s| s.contains("gone")));
    }

    #[test]
    fn content_and_metadata_writes_are_ignored() {
        assert!(!affects_listing(&EventKind::Modify(ModifyKind::Data(DataChange::Content))));
        assert!(!affects_listing(&EventKind::Modify(ModifyKind::Metadata(
            MetadataKind::WriteTime
        ))));
        assert!(!affects_listing(&EventKind::Access(AccessKind::Read)));
    }
}
