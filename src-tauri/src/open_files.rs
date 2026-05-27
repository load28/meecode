//! Live external-change detection for the files open in the editor.
//!
//! VS Code keeps a watch on every open document so a change made by another
//! tool (a formatter, `git checkout`, a second editor) reloads the buffer — or
//! raises a save conflict — immediately, not just on the next window refocus.
//! The project-tree watcher in `file_watch` deliberately ignores file *content*
//! events (it only reconciles directory listings); this watcher does the
//! opposite, watching exactly the open files and emitting `file:external-change`
//! with the fresh `(mtime, size)` signature for the ones that actually moved.

use crate::commands::mtime_ms_of;
use notify_debouncer_full::{
    new_debouncer,
    notify::{event::ModifyKind, EventKind, RecommendedWatcher, RecursiveMode},
    DebounceEventResult, Debouncer, RecommendedCache,
};
use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::Duration;
use tauri::{AppHandle, Emitter, State};

const DEBOUNCE_MS: u64 = 200;

#[derive(Default)]
pub struct OpenFilesState {
    /// The single live watcher; replaced wholesale whenever the open-file set
    /// changes, and dropped (stopping the watch) when nothing is open.
    watcher: Mutex<Option<Debouncer<RecommendedWatcher, RecommendedCache>>>,
}

#[derive(serde::Serialize, Clone)]
struct ExternalChangeEvent {
    path: String,
    mtime_ms: u64,
    size: u64,
}

/// Events that can mean "this file's bytes changed": data/metadata writes, and
/// creates (an atomic save lands as a create at the final path).
fn is_content_event(kind: &EventKind) -> bool {
    matches!(
        kind,
        EventKind::Modify(ModifyKind::Data(_))
            | EventKind::Modify(ModifyKind::Any)
            | EventKind::Modify(ModifyKind::Metadata(_))
            | EventKind::Create(_)
    )
}

#[derive(serde::Deserialize)]
pub struct SetWatchedFilesArgs {
    pub paths: Vec<String>,
}

/// Replace the set of editor-open files being watched for external changes.
/// Called by the frontend whenever the open real-file tabs change.
#[tauri::command]
pub fn set_watched_files(
    app: AppHandle,
    state: State<OpenFilesState>,
    args: SetWatchedFilesArgs,
) -> Result<(), String> {
    let mut guard = state.watcher.lock().map_err(|e| e.to_string())?;

    if args.paths.is_empty() {
        *guard = None; // dropping the debouncer stops the watch
        return Ok(());
    }

    let watched: HashSet<PathBuf> = args.paths.iter().map(PathBuf::from).collect();
    // Watch each file's *parent directory*, not the file node directly: an
    // atomic save writes a temp file and renames it over the target, so the
    // original inode vanishes and a direct file watch would go deaf. Filtering
    // events back down to `watched` keeps us to just the open files.
    let dirs: HashSet<PathBuf> = watched
        .iter()
        .filter_map(|p| p.parent().map(Path::to_path_buf))
        .collect();

    let app_cb = app.clone();
    let watched_cb = watched.clone();
    let mut debouncer = new_debouncer(
        Duration::from_millis(DEBOUNCE_MS),
        None,
        move |res: DebounceEventResult| {
            let Ok(events) = res else { return };
            let mut emitted: HashSet<PathBuf> = HashSet::new();
            for ev in events {
                if !is_content_event(&ev.kind) {
                    continue;
                }
                for path in &ev.paths {
                    if !watched_cb.contains(path) || !emitted.insert(path.clone()) {
                        continue;
                    }
                    if let Ok(meta) = std::fs::metadata(path) {
                        if meta.is_file() {
                            // Broadcast: whichever window owns the file panel
                            // (main when docked, the satellite when detached)
                            // filters to its own open tabs.
                            let _ = app_cb.emit(
                                "file:external-change",
                                ExternalChangeEvent {
                                    path: path.to_string_lossy().into_owned(),
                                    mtime_ms: mtime_ms_of(&meta),
                                    size: meta.len(),
                                },
                            );
                        }
                    }
                }
            }
        },
    )
    .map_err(|e| format!("open-files watcher: {e}"))?;

    for dir in &dirs {
        let _ = debouncer.watch(dir.as_path(), RecursiveMode::NonRecursive);
    }
    *guard = Some(debouncer);
    Ok(())
}
