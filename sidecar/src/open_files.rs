//! Live external-change detection for the files open in the editor (ported from
//! the Tauri lib, tauri-free). Watches each open file's *parent directory* (so
//! atomic saves that rename over the target aren't missed) and emits
//! `file:external-change` with a fresh `(mtime, size)` for the open files that
//! actually changed.

use crate::bridge::emit_event;
use crate::files::mtime_ms_of;
use crate::state::open_files;
use notify_debouncer_full::{
    new_debouncer,
    notify::{event::ModifyKind, EventKind, RecommendedWatcher, RecursiveMode},
    DebounceEventResult, Debouncer, RecommendedCache,
};
use serde::Deserialize;
use serde_json::json;
use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::Duration;

const DEBOUNCE_MS: u64 = 200;

#[derive(Default)]
pub struct OpenFilesState {
    /// The single live watcher; replaced wholesale when the open-file set
    /// changes, dropped (stopping the watch) when nothing is open.
    watcher: Mutex<Option<Debouncer<RecommendedWatcher, RecommendedCache>>>,
}

fn is_content_event(kind: &EventKind) -> bool {
    matches!(
        kind,
        EventKind::Modify(ModifyKind::Data(_))
            | EventKind::Modify(ModifyKind::Any)
            | EventKind::Modify(ModifyKind::Metadata(_))
            | EventKind::Create(_)
    )
}

#[derive(Deserialize)]
pub struct SetWatchedFilesArgs {
    pub paths: Vec<String>,
}

/// Replace the set of editor-open files being watched for external changes.
pub fn set_watched_files(args: SetWatchedFilesArgs) -> Result<(), String> {
    let mut guard = open_files().watcher.lock().map_err(|e| e.to_string())?;

    if args.paths.is_empty() {
        *guard = None; // dropping the debouncer stops the watch
        return Ok(());
    }

    let watched: HashSet<PathBuf> = args.paths.iter().map(PathBuf::from).collect();
    let dirs: HashSet<PathBuf> = watched
        .iter()
        .filter_map(|p| p.parent().map(Path::to_path_buf))
        .collect();

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
                            emit_event(
                                "file:external-change",
                                json!({
                                    "path": path.to_string_lossy(),
                                    "mtime_ms": mtime_ms_of(&meta),
                                    "size": meta.len(),
                                }),
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
