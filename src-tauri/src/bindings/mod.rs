//! Session ↔ Task bindings.
//!
//! A binding is a (session_id, task_id) pair that says "this Claude Code
//! session has this Task attached." The relationship is N:N — one session
//! can have multiple Tasks, one Task can be attached to multiple sessions.
//!
//! Persisted as JSONL at `~/.meecode/bindings.jsonl` so attachments
//! survive across app restarts (sessions resume by id, and we pick up the
//! bindings on the next list call).
//!
//! Detach removes the binding from storage; **it does not** try to rewind
//! whatever context was already injected into the LLM's view of the
//! session. That's structurally impossible and the user explicitly opted
//! out of pretending otherwise.

use serde::{Deserialize, Serialize};
use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Binding {
    pub session_id: String,
    pub task_id: String,
    pub attached_at_ms: u64,
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

fn default_root() -> PathBuf {
    dirs::home_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join(".meecode")
}

pub fn default_bindings_root() -> PathBuf {
    default_root()
}

fn bindings_file(root: &Path) -> PathBuf {
    root.join("bindings.jsonl")
}

pub fn list_all(root: &Path) -> Result<Vec<Binding>, String> {
    let path = bindings_file(root);
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
        if let Ok(b) = serde_json::from_str::<Binding>(trimmed) {
            out.push(b);
        }
    }
    Ok(out)
}

pub fn list_for_session(root: &Path, session_id: &str) -> Result<Vec<Binding>, String> {
    let all = list_all(root)?;
    Ok(all.into_iter().filter(|b| b.session_id == session_id).collect())
}

pub fn attach(root: &Path, session_id: String, task_id: String) -> Result<Binding, String> {
    if session_id.is_empty() {
        return Err("session_id cannot be empty".into());
    }
    if task_id.is_empty() {
        return Err("task_id cannot be empty".into());
    }
    let all = list_all(root)?;
    // Idempotent: a pre-existing binding short-circuits without dupes.
    if let Some(existing) = all
        .iter()
        .find(|b| b.session_id == session_id && b.task_id == task_id)
    {
        return Ok(existing.clone());
    }
    fs::create_dir_all(root).map_err(|e| e.to_string())?;
    let binding = Binding {
        session_id,
        task_id,
        attached_at_ms: now_ms(),
    };
    let line = serde_json::to_string(&binding).map_err(|e| e.to_string())?;
    let mut f = fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(bindings_file(root))
        .map_err(|e| e.to_string())?;
    writeln!(f, "{}", line).map_err(|e| e.to_string())?;
    Ok(binding)
}

pub fn detach(root: &Path, session_id: &str, task_id: &str) -> Result<(), String> {
    let all = list_all(root)?;
    let kept: Vec<Binding> = all
        .into_iter()
        .filter(|b| !(b.session_id == session_id && b.task_id == task_id))
        .collect();
    let path = bindings_file(root);
    if kept.is_empty() {
        if path.exists() {
            fs::write(&path, "").map_err(|e| e.to_string())?;
        }
        return Ok(());
    }
    let mut body = String::new();
    for b in kept {
        body.push_str(&serde_json::to_string(&b).map_err(|e| e.to_string())?);
        body.push('\n');
    }
    fs::write(&path, body).map_err(|e| e.to_string())
}

/// Drop every binding for a Task — used when the Task itself is deleted
/// so no orphans linger in `bindings.jsonl`.
pub fn detach_all_for_task(root: &Path, task_id: &str) -> Result<(), String> {
    let all = list_all(root)?;
    let kept: Vec<Binding> = all.into_iter().filter(|b| b.task_id != task_id).collect();
    let path = bindings_file(root);
    if kept.is_empty() {
        if path.exists() {
            fs::write(&path, "").map_err(|e| e.to_string())?;
        }
        return Ok(());
    }
    let mut body = String::new();
    for b in kept {
        body.push_str(&serde_json::to_string(&b).map_err(|e| e.to_string())?);
        body.push('\n');
    }
    fs::write(&path, body).map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    fn root() -> (tempfile::TempDir, PathBuf) {
        let dir = tempdir().unwrap();
        let path = dir.path().to_path_buf();
        (dir, path)
    }

    #[test]
    fn attach_then_list() {
        let (_g, root) = root();
        let b = attach(&root, "sess-1".into(), "task-a".into()).unwrap();
        assert_eq!(b.session_id, "sess-1");
        assert_eq!(b.task_id, "task-a");
        let list = list_for_session(&root, "sess-1").unwrap();
        assert_eq!(list.len(), 1);
    }

    #[test]
    fn attach_is_idempotent() {
        let (_g, root) = root();
        attach(&root, "s".into(), "t".into()).unwrap();
        attach(&root, "s".into(), "t".into()).unwrap();
        attach(&root, "s".into(), "t".into()).unwrap();
        assert_eq!(list_for_session(&root, "s").unwrap().len(), 1);
    }

    #[test]
    fn multiple_tasks_per_session() {
        let (_g, root) = root();
        attach(&root, "s".into(), "t1".into()).unwrap();
        attach(&root, "s".into(), "t2".into()).unwrap();
        attach(&root, "s".into(), "t3".into()).unwrap();
        assert_eq!(list_for_session(&root, "s").unwrap().len(), 3);
    }

    #[test]
    fn same_task_across_sessions() {
        let (_g, root) = root();
        attach(&root, "a".into(), "t".into()).unwrap();
        attach(&root, "b".into(), "t".into()).unwrap();
        assert_eq!(list_for_session(&root, "a").unwrap().len(), 1);
        assert_eq!(list_for_session(&root, "b").unwrap().len(), 1);
        assert_eq!(list_all(&root).unwrap().len(), 2);
    }

    #[test]
    fn detach_removes_one() {
        let (_g, root) = root();
        attach(&root, "s".into(), "t1".into()).unwrap();
        attach(&root, "s".into(), "t2".into()).unwrap();
        detach(&root, "s", "t1").unwrap();
        let list = list_for_session(&root, "s").unwrap();
        assert_eq!(list.len(), 1);
        assert_eq!(list[0].task_id, "t2");
    }

    #[test]
    fn detach_idempotent() {
        let (_g, root) = root();
        detach(&root, "s", "t").unwrap();
        attach(&root, "s".into(), "t".into()).unwrap();
        detach(&root, "s", "t").unwrap();
        detach(&root, "s", "t").unwrap();
        assert!(list_for_session(&root, "s").unwrap().is_empty());
    }

    #[test]
    fn detach_all_for_task_cleans_orphans() {
        let (_g, root) = root();
        attach(&root, "s1".into(), "t-doomed".into()).unwrap();
        attach(&root, "s2".into(), "t-doomed".into()).unwrap();
        attach(&root, "s1".into(), "t-other".into()).unwrap();
        detach_all_for_task(&root, "t-doomed").unwrap();
        let all = list_all(&root).unwrap();
        assert_eq!(all.len(), 1);
        assert_eq!(all[0].task_id, "t-other");
    }

    #[test]
    fn rejects_empty_ids() {
        let (_g, root) = root();
        assert!(attach(&root, "".into(), "t".into()).is_err());
        assert!(attach(&root, "s".into(), "".into()).is_err());
    }

    #[test]
    fn empty_list_when_no_file() {
        let dir = tempdir().unwrap();
        let missing = dir.path().join("nope");
        assert!(list_all(&missing).unwrap().is_empty());
        assert!(list_for_session(&missing, "s").unwrap().is_empty());
    }
}
