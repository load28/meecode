use serde::Serialize;
use std::path::PathBuf;
use std::time::SystemTime;

#[derive(Serialize, Clone, Debug)]
pub struct ProjectInfo {
    pub path: String,
    pub session_count: usize,
    pub last_modified_ms: u64,
}

#[derive(Serialize, Clone, Debug)]
pub struct SessionInfo {
    pub session_id: String,
    pub modified_ms: u64,
    pub size_bytes: u64,
    pub first_message: Option<String>,
    pub message_count: usize,
}

fn modified_ms(t: SystemTime) -> u64 {
    t.duration_since(SystemTime::UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

fn folder_to_path(folder: &str) -> String {
    // Folder name uses `-` as the path separator. The encoding is lossy for
    // paths that legitimately contain dashes, but it matches what Claude CLI
    // produces in `~/.claude/projects/`.
    format!("/{}", folder.trim_start_matches('-').replace('-', "/"))
}

pub fn list_projects() -> Result<Vec<ProjectInfo>, String> {
    let home = dirs::home_dir().ok_or_else(|| "no home dir".to_string())?;
    let root = home.join(".claude").join("projects");
    if !root.exists() {
        return Ok(Vec::new());
    }
    let entries = std::fs::read_dir(&root).map_err(|e| e.to_string())?;
    let mut out: Vec<ProjectInfo> = Vec::new();
    for entry in entries.flatten() {
        let path = entry.path();
        if !path.is_dir() {
            continue;
        }
        let folder = match path.file_name().and_then(|s| s.to_str()) {
            Some(s) => s.to_string(),
            None => continue,
        };
        let mut session_count = 0usize;
        let mut newest = SystemTime::UNIX_EPOCH;
        if let Ok(sessions) = std::fs::read_dir(&path) {
            for s in sessions.flatten() {
                let p = s.path();
                if p.extension().and_then(|s| s.to_str()) != Some("jsonl") {
                    continue;
                }
                session_count += 1;
                if let Ok(meta) = s.metadata() {
                    if let Ok(m) = meta.modified() {
                        if m > newest {
                            newest = m;
                        }
                    }
                }
            }
        }
        if session_count == 0 {
            continue;
        }
        out.push(ProjectInfo {
            path: folder_to_path(&folder),
            session_count,
            last_modified_ms: modified_ms(newest),
        });
    }
    out.sort_by(|a, b| b.last_modified_ms.cmp(&a.last_modified_ms));
    Ok(out)
}

pub fn list_sessions(project_path: &str) -> Result<Vec<SessionInfo>, String> {
    let dir = super::load_recent::projects_dir_for(project_path)?;
    if !dir.exists() {
        return Ok(Vec::new());
    }
    let entries = std::fs::read_dir(&dir).map_err(|e| e.to_string())?;
    let mut out: Vec<SessionInfo> = Vec::new();
    for entry in entries.flatten() {
        let path: PathBuf = entry.path();
        if path.extension().and_then(|s| s.to_str()) != Some("jsonl") {
            continue;
        }
        let session_id = path
            .file_stem()
            .and_then(|s| s.to_str())
            .unwrap_or("")
            .to_string();
        if session_id.is_empty() {
            continue;
        }
        let meta = match entry.metadata() {
            Ok(m) => m,
            Err(_) => continue,
        };
        let modified = meta.modified().unwrap_or(SystemTime::UNIX_EPOCH);
        let size = meta.len();
        let (first_message, message_count) = preview_session(&path);
        out.push(SessionInfo {
            session_id,
            modified_ms: modified_ms(modified),
            size_bytes: size,
            first_message,
            message_count,
        });
    }
    out.sort_by(|a, b| b.modified_ms.cmp(&a.modified_ms));
    Ok(out)
}

fn preview_session(path: &std::path::Path) -> (Option<String>, usize) {
    use std::io::{BufRead, BufReader};
    let file = match std::fs::File::open(path) {
        Ok(f) => f,
        Err(_) => return (None, 0),
    };
    let reader = BufReader::new(file);
    let mut first: Option<String> = None;
    let mut count = 0usize;
    for line in reader.lines().map_while(Result::ok) {
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }
        let v: serde_json::Value = match serde_json::from_str(trimmed) {
            Ok(v) => v,
            Err(_) => continue,
        };
        let t = v.get("type").and_then(|x| x.as_str()).unwrap_or("");
        if t == "user" {
            count += 1;
            if first.is_none() {
                let content = v.get("message").and_then(|m| m.get("content"));
                if let Some(c) = content {
                    if let Some(s) = c.as_str() {
                        first = Some(truncate(s, 80));
                    } else if let Some(arr) = c.as_array() {
                        for item in arr {
                            if item.get("type").and_then(|x| x.as_str()) == Some("text") {
                                if let Some(s) = item.get("text").and_then(|x| x.as_str()) {
                                    first = Some(truncate(s, 80));
                                    break;
                                }
                            }
                        }
                    }
                }
            }
        }
    }
    (first, count)
}

fn truncate(s: &str, n: usize) -> String {
    let first_line = s.lines().next().unwrap_or("").trim();
    if first_line.chars().count() <= n {
        first_line.to_string()
    } else {
        let mut out: String = first_line.chars().take(n).collect();
        out.push('…');
        out
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn folder_to_path_converts_dashes_to_slashes() {
        assert_eq!(
            folder_to_path("-Users-me-Downloads-meecode"),
            "/Users/me/Downloads/meecode"
        );
    }

    #[test]
    fn truncate_keeps_short_strings() {
        assert_eq!(truncate("hello", 80), "hello");
    }

    #[test]
    fn truncate_caps_long_strings() {
        let long: String = "a".repeat(120);
        let out = truncate(&long, 50);
        assert!(out.ends_with('…'));
        assert_eq!(out.chars().count(), 51);
    }

    #[test]
    fn truncate_uses_first_line_only() {
        assert_eq!(truncate("line1\nline2", 80), "line1");
    }
}
