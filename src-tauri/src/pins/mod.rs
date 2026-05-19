use serde::{Deserialize, Serialize};
use std::fs;
use std::io::Write;
use std::path::PathBuf;
use std::time::{SystemTime, UNIX_EPOCH};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Pin {
    pub id: String,
    #[serde(default)]
    pub session_id: Option<String>,
    #[serde(default)]
    pub qa_id: Option<String>,
    pub segment_kind: String,
    pub text: String,
    pub picked_at_ms: u64,
    pub marker: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct WikiFile {
    pub name: String,
    pub size_bytes: u64,
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

fn meecode_dir(project_path: &str) -> PathBuf {
    PathBuf::from(project_path).join(".meecode")
}

pub fn pins_path(project_path: &str) -> PathBuf {
    meecode_dir(project_path).join("pins.jsonl")
}

pub fn wiki_dir(project_path: &str) -> PathBuf {
    meecode_dir(project_path).join("wiki")
}

pub fn list_pins(project_path: &str) -> Result<Vec<Pin>, String> {
    let path = pins_path(project_path);
    if !path.exists() {
        return Ok(Vec::new());
    }
    let content = fs::read_to_string(&path).map_err(|e| e.to_string())?;
    let mut out = Vec::new();
    for line in content.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }
        if let Ok(pin) = serde_json::from_str::<Pin>(trimmed) {
            out.push(pin);
        }
    }
    Ok(out)
}

pub fn append_pin(
    project_path: &str,
    session_id: Option<String>,
    qa_id: Option<String>,
    segment_kind: String,
    text: String,
) -> Result<Pin, String> {
    fs::create_dir_all(meecode_dir(project_path)).map_err(|e| e.to_string())?;
    let existing = list_pins(project_path).unwrap_or_default();
    let next_num = existing
        .iter()
        .filter_map(|p| {
            p.marker
                .strip_prefix("pin-")
                .and_then(|s| s.parse::<u64>().ok())
        })
        .max()
        .unwrap_or(0)
        + 1;
    let marker = format!("pin-{}", next_num);
    let ts = now_ms();
    let id = format!("{}-{}", ts, next_num);
    let pin = Pin {
        id,
        session_id,
        qa_id,
        segment_kind,
        text,
        picked_at_ms: ts,
        marker,
    };
    let line = serde_json::to_string(&pin).map_err(|e| e.to_string())?;
    let path = pins_path(project_path);
    let mut f = fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(&path)
        .map_err(|e| e.to_string())?;
    writeln!(f, "{}", line).map_err(|e| e.to_string())?;
    Ok(pin)
}

pub fn delete_pin(project_path: &str, pin_id: &str) -> Result<(), String> {
    let pins = list_pins(project_path)?;
    let kept: Vec<Pin> = pins.into_iter().filter(|p| p.id != pin_id).collect();
    let path = pins_path(project_path);
    if kept.is_empty() {
        if path.exists() {
            fs::write(&path, "").map_err(|e| e.to_string())?;
        }
        return Ok(());
    }
    let mut body = String::new();
    for p in kept {
        let line = serde_json::to_string(&p).map_err(|e| e.to_string())?;
        body.push_str(&line);
        body.push('\n');
    }
    fs::write(&path, body).map_err(|e| e.to_string())
}

pub fn list_wiki_files(project_path: &str) -> Result<Vec<WikiFile>, String> {
    let dir = wiki_dir(project_path);
    if !dir.exists() {
        return Ok(Vec::new());
    }
    let entries = fs::read_dir(&dir).map_err(|e| e.to_string())?;
    let mut out: Vec<WikiFile> = Vec::new();
    for entry in entries.flatten() {
        let p = entry.path();
        if p.extension().and_then(|s| s.to_str()) != Some("md") {
            continue;
        }
        let name = match p.file_name().and_then(|s| s.to_str()) {
            Some(s) => s.to_string(),
            None => continue,
        };
        let size = entry.metadata().map(|m| m.len()).unwrap_or(0);
        out.push(WikiFile {
            name,
            size_bytes: size,
        });
    }
    out.sort_by(|a, b| a.name.cmp(&b.name));
    Ok(out)
}

pub fn read_wiki_file(project_path: &str, file_name: &str) -> Result<String, String> {
    validate_wiki_name(file_name)?;
    let path = wiki_dir(project_path).join(file_name);
    if !path.exists() {
        return Ok(String::new());
    }
    fs::read_to_string(&path).map_err(|e| e.to_string())
}

pub fn write_wiki_file(
    project_path: &str,
    file_name: &str,
    content: &str,
) -> Result<(), String> {
    validate_wiki_name(file_name)?;
    fs::create_dir_all(wiki_dir(project_path)).map_err(|e| e.to_string())?;
    let path = wiki_dir(project_path).join(file_name);
    fs::write(&path, content).map_err(|e| e.to_string())
}

pub fn delete_wiki_file(project_path: &str, file_name: &str) -> Result<(), String> {
    validate_wiki_name(file_name)?;
    let path = wiki_dir(project_path).join(file_name);
    if path.exists() {
        fs::remove_file(&path).map_err(|e| e.to_string())?;
    }
    Ok(())
}

fn validate_wiki_name(file_name: &str) -> Result<(), String> {
    if file_name.is_empty()
        || file_name.contains('/')
        || file_name.contains('\\')
        || file_name.contains("..")
        || file_name.starts_with('.')
    {
        return Err(format!("invalid wiki file name: {file_name}"));
    }
    if !file_name.ends_with(".md") {
        return Err(format!("wiki file must end with .md: {file_name}"));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    #[test]
    fn append_then_list_roundtrip() {
        let dir = tempdir().unwrap();
        let project = dir.path().to_string_lossy().to_string();
        let pin = append_pin(
            &project,
            Some("sess-1".into()),
            Some("qa-1".into()),
            "text".into(),
            "hello world".into(),
        )
        .unwrap();
        assert_eq!(pin.marker, "pin-1");

        let pins = list_pins(&project).unwrap();
        assert_eq!(pins.len(), 1);
        assert_eq!(pins[0].text, "hello world");
        assert_eq!(pins[0].marker, "pin-1");
        assert_eq!(pins[0].session_id.as_deref(), Some("sess-1"));
    }

    #[test]
    fn marker_increments() {
        let dir = tempdir().unwrap();
        let project = dir.path().to_string_lossy().to_string();
        let p1 = append_pin(&project, None, None, "text".into(), "a".into()).unwrap();
        let p2 = append_pin(&project, None, None, "text".into(), "b".into()).unwrap();
        let p3 = append_pin(&project, None, None, "text".into(), "c".into()).unwrap();
        assert_eq!(p1.marker, "pin-1");
        assert_eq!(p2.marker, "pin-2");
        assert_eq!(p3.marker, "pin-3");
    }

    #[test]
    fn delete_pin_removes_it() {
        let dir = tempdir().unwrap();
        let project = dir.path().to_string_lossy().to_string();
        let a = append_pin(&project, None, None, "text".into(), "a".into()).unwrap();
        let _b = append_pin(&project, None, None, "text".into(), "b".into()).unwrap();
        delete_pin(&project, &a.id).unwrap();
        let pins = list_pins(&project).unwrap();
        assert_eq!(pins.len(), 1);
        assert_eq!(pins[0].text, "b");
    }

    #[test]
    fn list_pins_empty_when_no_file() {
        let dir = tempdir().unwrap();
        let project = dir.path().to_string_lossy().to_string();
        assert_eq!(list_pins(&project).unwrap().len(), 0);
    }

    #[test]
    fn write_then_list_wiki() {
        let dir = tempdir().unwrap();
        let project = dir.path().to_string_lossy().to_string();
        write_wiki_file(&project, "decisions.md", "# Decisions\n").unwrap();
        write_wiki_file(&project, "glossary.md", "# Glossary\n").unwrap();
        let files = list_wiki_files(&project).unwrap();
        assert_eq!(files.len(), 2);
        assert_eq!(files[0].name, "decisions.md");
        assert_eq!(files[1].name, "glossary.md");
        let content = read_wiki_file(&project, "decisions.md").unwrap();
        assert_eq!(content, "# Decisions\n");
    }

    #[test]
    fn rejects_path_traversal() {
        let dir = tempdir().unwrap();
        let project = dir.path().to_string_lossy().to_string();
        assert!(write_wiki_file(&project, "../escape.md", "x").is_err());
        assert!(write_wiki_file(&project, "sub/file.md", "x").is_err());
        assert!(write_wiki_file(&project, "no-ext", "x").is_err());
        assert!(write_wiki_file(&project, ".hidden.md", "x").is_err());
    }

    #[test]
    fn delete_wiki_removes_file() {
        let dir = tempdir().unwrap();
        let project = dir.path().to_string_lossy().to_string();
        write_wiki_file(&project, "tmp.md", "x").unwrap();
        delete_wiki_file(&project, "tmp.md").unwrap();
        let files = list_wiki_files(&project).unwrap();
        assert!(files.is_empty());
    }
}
