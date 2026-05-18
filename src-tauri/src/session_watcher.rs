use notify::{Event, EventKind, RecommendedWatcher, RecursiveMode, Watcher};
use serde_json::Value;
use std::path::{Path, PathBuf};
use std::sync::mpsc::channel;
use std::sync::{Arc, Mutex};
use std::time::SystemTime;
use tauri::{AppHandle, Emitter};

pub struct SessionWatcher {
    _watcher: RecommendedWatcher,
}

impl SessionWatcher {
    pub fn start(app: AppHandle, project_path: &str, threshold: usize) -> Result<Self, String> {
        let projects_dir = Self::projects_dir_for(project_path)?;
        std::fs::create_dir_all(&projects_dir).map_err(|e| e.to_string())?;

        let (tx, rx) = channel::<notify::Result<Event>>();
        let mut watcher: RecommendedWatcher =
            Watcher::new(tx, notify::Config::default()).map_err(|e| e.to_string())?;
        watcher
            .watch(&projects_dir, RecursiveMode::NonRecursive)
            .map_err(|e| e.to_string())?;

        let last_emitted: Arc<Mutex<String>> = Arc::new(Mutex::new(String::new()));
        let dir_for_thread = projects_dir.clone();

        std::thread::spawn(move || {
            loop {
                match rx.recv() {
                    Ok(Ok(event)) => match event.kind {
                        EventKind::Create(_) | EventKind::Modify(_) => {
                            if let Some(text) = Self::latest_assistant_text(&dir_for_thread) {
                                if text.len() >= threshold {
                                    let mut last = last_emitted.lock().unwrap();
                                    if *last != text {
                                        *last = text.clone();
                                        app.emit("md:update", text).ok();
                                    }
                                }
                            }
                        }
                        _ => {}
                    },
                    Ok(Err(_)) => {}
                    Err(_) => break,
                }
            }
        });

        Ok(SessionWatcher { _watcher: watcher })
    }

    pub fn projects_dir_for(project_path: &str) -> Result<PathBuf, String> {
        let home = dirs::home_dir().ok_or_else(|| "no home dir".to_string())?;
        let dash_path = project_path.replace('/', "-");
        Ok(home.join(".claude").join("projects").join(dash_path))
    }

    pub fn latest_assistant_text(dir: &Path) -> Option<String> {
        let entries = std::fs::read_dir(dir).ok()?;
        let mut newest: Option<(PathBuf, SystemTime)> = None;
        for entry in entries.flatten() {
            let path = entry.path();
            if path.extension().and_then(|s| s.to_str()) != Some("jsonl") {
                continue;
            }
            let modified = entry.metadata().and_then(|m| m.modified()).ok()?;
            match &newest {
                Some((_, t)) if *t >= modified => {}
                _ => newest = Some((path, modified)),
            }
        }
        let (path, _) = newest?;
        extract_last_assistant_text(&path)
    }
}

pub fn extract_last_assistant_text(path: &Path) -> Option<String> {
    let content = std::fs::read_to_string(path).ok()?;
    let mut last: Option<String> = None;
    for line in content.lines() {
        let line = line.trim();
        if line.is_empty() {
            continue;
        }
        let v: Value = match serde_json::from_str(line) {
            Ok(v) => v,
            Err(_) => continue,
        };
        if v.get("type").and_then(|t| t.as_str()) != Some("assistant") {
            continue;
        }
        let content_arr = v
            .get("message")
            .and_then(|m| m.get("content"))
            .and_then(|c| c.as_array());
        let Some(arr) = content_arr else { continue };
        let mut text = String::new();
        for item in arr {
            if item.get("type").and_then(|t| t.as_str()) == Some("text") {
                if let Some(s) = item.get("text").and_then(|t| t.as_str()) {
                    if !text.is_empty() {
                        text.push('\n');
                    }
                    text.push_str(s);
                }
            }
        }
        if !text.is_empty() {
            last = Some(text);
        }
    }
    last
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;
    use tempfile::NamedTempFile;

    #[test]
    fn projects_dir_replaces_slashes_with_dashes() {
        let dir = SessionWatcher::projects_dir_for("/Users/me/Downloads/test").unwrap();
        assert!(dir.ends_with("-Users-me-Downloads-test"));
        assert!(dir.to_string_lossy().contains(".claude/projects"));
    }

    #[test]
    fn extract_returns_last_assistant_text() {
        let mut file = NamedTempFile::new().unwrap();
        writeln!(
            file,
            "{}",
            r#"{"type":"user","message":{"content":"hello"}}"#
        )
        .unwrap();
        writeln!(
            file,
            "{}",
            r#"{"type":"assistant","message":{"content":[{"type":"text","text":"first answer"}]}}"#
        )
        .unwrap();
        writeln!(file, "{}", r#"{"type":"system","subtype":"x"}"#).unwrap();
        writeln!(
            file,
            "{}",
            r#"{"type":"assistant","message":{"content":[{"type":"text","text":"second answer"}]}}"#
        )
        .unwrap();
        let result = extract_last_assistant_text(file.path()).unwrap();
        assert_eq!(result, "second answer");
    }

    #[test]
    fn extract_returns_none_when_no_assistant() {
        let mut file = NamedTempFile::new().unwrap();
        writeln!(
            file,
            "{}",
            r#"{"type":"user","message":{"content":"hello"}}"#
        )
        .unwrap();
        assert!(extract_last_assistant_text(file.path()).is_none());
    }

    #[test]
    fn extract_joins_multiple_text_blocks() {
        let mut file = NamedTempFile::new().unwrap();
        writeln!(
            file,
            "{}",
            r#"{"type":"assistant","message":{"content":[{"type":"text","text":"part1"},{"type":"text","text":"part2"}]}}"#
        )
        .unwrap();
        let result = extract_last_assistant_text(file.path()).unwrap();
        assert_eq!(result, "part1\npart2");
    }

    #[test]
    fn extract_ignores_non_text_content() {
        let mut file = NamedTempFile::new().unwrap();
        writeln!(
            file,
            "{}",
            r#"{"type":"assistant","message":{"content":[{"type":"tool_use","id":"x"},{"type":"text","text":"answer"}]}}"#
        )
        .unwrap();
        let result = extract_last_assistant_text(file.path()).unwrap();
        assert_eq!(result, "answer");
    }
}
