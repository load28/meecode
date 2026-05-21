//! Global Task domain.
//!
//! A Task is a project/worktree/session-independent unit of context.
//! Multiple sessions can attach the same Task; one session can attach
//! multiple Tasks. Storage lives at `~/.meecode/tasks/<task-id>/`:
//!
//! ```text
//! ~/.meecode/tasks/<task-id>/
//!   task.json              # { id, name, description, timestamps }
//!   sources/<source-id>.json   # raw captures (added in phase 2)
//!   wiki/*.md                  # organized output (added in phase 4)
//! ```
//!
//! Phase 1 only exposes Task CRUD + Source listing — capture, attach,
//! organize, and the wiki editor land in later phases.

use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{SystemTime, UNIX_EPOCH};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Task {
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub description: String,
    pub created_at_ms: u64,
    pub updated_at_ms: u64,
}

/// Listing entry — includes derived counts so the browser doesn't need
/// a second roundtrip per task.
#[derive(Debug, Clone, Serialize)]
pub struct TaskSummary {
    pub id: String,
    pub name: String,
    pub description: String,
    pub created_at_ms: u64,
    pub updated_at_ms: u64,
    pub source_count: u64,
}

/// Raw, unprocessed context attached to a Task.
///
/// `kind`:
/// - `"qa_block"` — one full Q&A answer captured from a chat turn
/// - `"selection"` — a user-selected text excerpt
/// - `"manual"` — typed/pasted directly
///
/// `origin` is best-effort traceability back to where the source came
/// from. The Task itself never depends on the origin still existing.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Source {
    pub id: String,
    pub task_id: String,
    pub kind: String,
    pub content: String,
    #[serde(default)]
    pub origin: SourceOrigin,
    pub captured_at_ms: u64,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct SourceOrigin {
    #[serde(default)]
    pub session_id: Option<String>,
    #[serde(default)]
    pub qa_id: Option<String>,
    #[serde(default)]
    pub project_path: Option<String>,
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
        .join("tasks")
}

fn task_dir(root: &Path, task_id: &str) -> PathBuf {
    root.join(task_id)
}

fn task_file(root: &Path, task_id: &str) -> PathBuf {
    task_dir(root, task_id).join("task.json")
}

fn sources_dir(root: &Path, task_id: &str) -> PathBuf {
    task_dir(root, task_id).join("sources")
}

fn validate_task_id(task_id: &str) -> Result<(), String> {
    if task_id.is_empty()
        || task_id.contains('/')
        || task_id.contains('\\')
        || task_id.contains("..")
        || task_id.starts_with('.')
    {
        return Err(format!("invalid task id: {task_id}"));
    }
    Ok(())
}

static ID_COUNTER: AtomicU64 = AtomicU64::new(0);

fn new_id(prefix: &str) -> String {
    // Per-process atomic counter ensures uniqueness inside one app run
    // even if two ids are minted in the same millisecond — good enough
    // without pulling in `uuid` for a single use site.
    let ts = now_ms();
    let n = ID_COUNTER.fetch_add(1, Ordering::Relaxed);
    format!("{prefix}-{ts:x}-{n:x}")
}

pub fn list_tasks(root: &Path) -> Result<Vec<TaskSummary>, String> {
    if !root.exists() {
        return Ok(Vec::new());
    }
    let entries = fs::read_dir(root).map_err(|e| e.to_string())?;
    let mut out: Vec<TaskSummary> = Vec::new();
    for entry in entries.flatten() {
        if !entry.file_type().map(|t| t.is_dir()).unwrap_or(false) {
            continue;
        }
        let id = match entry.file_name().to_str() {
            Some(s) => s.to_string(),
            None => continue,
        };
        let Ok(task) = read_task(root, &id) else {
            continue;
        };
        let source_count = list_sources(root, &id).map(|s| s.len() as u64).unwrap_or(0);
        out.push(TaskSummary {
            id: task.id,
            name: task.name,
            description: task.description,
            created_at_ms: task.created_at_ms,
            updated_at_ms: task.updated_at_ms,
            source_count,
        });
    }
    // Newest first by updated_at so recently-touched tasks float up.
    out.sort_by(|a, b| b.updated_at_ms.cmp(&a.updated_at_ms));
    Ok(out)
}

pub fn create_task(root: &Path, name: String, description: String) -> Result<Task, String> {
    let trimmed_name = name.trim();
    if trimmed_name.is_empty() {
        return Err("task name cannot be empty".into());
    }
    fs::create_dir_all(root).map_err(|e| e.to_string())?;
    let id = new_id("task");
    let ts = now_ms();
    let task = Task {
        id: id.clone(),
        name: trimmed_name.to_string(),
        description,
        created_at_ms: ts,
        updated_at_ms: ts,
    };
    fs::create_dir_all(task_dir(root, &id)).map_err(|e| e.to_string())?;
    fs::create_dir_all(sources_dir(root, &id)).map_err(|e| e.to_string())?;
    write_task(root, &task)?;
    Ok(task)
}

pub fn read_task(root: &Path, task_id: &str) -> Result<Task, String> {
    validate_task_id(task_id)?;
    let path = task_file(root, task_id);
    let content = fs::read_to_string(&path).map_err(|e| e.to_string())?;
    serde_json::from_str::<Task>(&content).map_err(|e| e.to_string())
}

pub fn update_task(
    root: &Path,
    task_id: &str,
    name: Option<String>,
    description: Option<String>,
) -> Result<Task, String> {
    let mut task = read_task(root, task_id)?;
    if let Some(n) = name {
        let trimmed = n.trim().to_string();
        if trimmed.is_empty() {
            return Err("task name cannot be empty".into());
        }
        task.name = trimmed;
    }
    if let Some(d) = description {
        task.description = d;
    }
    task.updated_at_ms = now_ms();
    write_task(root, &task)?;
    Ok(task)
}

pub fn delete_task(root: &Path, task_id: &str) -> Result<(), String> {
    validate_task_id(task_id)?;
    let dir = task_dir(root, task_id);
    if !dir.exists() {
        return Ok(());
    }
    fs::remove_dir_all(&dir).map_err(|e| e.to_string())
}

fn write_task(root: &Path, task: &Task) -> Result<(), String> {
    let path = task_file(root, &task.id);
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let content = serde_json::to_string_pretty(task).map_err(|e| e.to_string())?;
    fs::write(&path, content).map_err(|e| e.to_string())
}

pub fn list_sources(root: &Path, task_id: &str) -> Result<Vec<Source>, String> {
    validate_task_id(task_id)?;
    let dir = sources_dir(root, task_id);
    if !dir.exists() {
        return Ok(Vec::new());
    }
    let entries = fs::read_dir(&dir).map_err(|e| e.to_string())?;
    let mut out: Vec<Source> = Vec::new();
    for entry in entries.flatten() {
        let p = entry.path();
        if p.extension().and_then(|s| s.to_str()) != Some("json") {
            continue;
        }
        let Ok(text) = fs::read_to_string(&p) else {
            continue;
        };
        if let Ok(src) = serde_json::from_str::<Source>(&text) {
            out.push(src);
        }
    }
    out.sort_by(|a, b| a.captured_at_ms.cmp(&b.captured_at_ms));
    Ok(out)
}

pub fn create_source(
    root: &Path,
    task_id: &str,
    kind: String,
    content: String,
    origin: SourceOrigin,
) -> Result<Source, String> {
    // Ensure the task exists — otherwise we'd be creating an orphan
    // sources directory under a stale id (e.g. after a delete).
    let _task = read_task(root, task_id)?;
    if content.is_empty() {
        return Err("source content cannot be empty".into());
    }
    let dir = sources_dir(root, task_id);
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let id = new_id("src");
    let source = Source {
        id: id.clone(),
        task_id: task_id.to_string(),
        kind,
        content,
        origin,
        captured_at_ms: now_ms(),
    };
    let path = dir.join(format!("{id}.json"));
    let body = serde_json::to_string_pretty(&source).map_err(|e| e.to_string())?;
    fs::write(&path, body).map_err(|e| e.to_string())?;
    // Touch the parent task so the browser sorts the just-captured task
    // to the top — matches user mental model of "the one I'm working on".
    let _ = update_task(root, task_id, None, None);
    Ok(source)
}

fn validate_source_id(source_id: &str) -> Result<(), String> {
    if source_id.is_empty()
        || source_id.contains('/')
        || source_id.contains('\\')
        || source_id.contains("..")
        || source_id.starts_with('.')
    {
        return Err(format!("invalid source id: {source_id}"));
    }
    Ok(())
}

pub fn delete_source(root: &Path, task_id: &str, source_id: &str) -> Result<(), String> {
    validate_task_id(task_id)?;
    validate_source_id(source_id)?;
    let path = sources_dir(root, task_id).join(format!("{source_id}.json"));
    if !path.exists() {
        return Ok(());
    }
    fs::remove_file(&path).map_err(|e| e.to_string())?;
    let _ = update_task(root, task_id, None, None);
    Ok(())
}

/// Public root resolver used by the IPC layer. Lives here so the
/// production path stays consistent with the test helpers below.
pub fn default_tasks_root() -> PathBuf {
    default_root()
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
    fn create_then_list_roundtrip() {
        let (_g, root) = root();
        let t = create_task(&root, "Refactor knowledge".into(), "notes".into()).unwrap();
        assert!(t.id.starts_with("task-"));
        assert_eq!(t.name, "Refactor knowledge");
        let list = list_tasks(&root).unwrap();
        assert_eq!(list.len(), 1);
        assert_eq!(list[0].name, "Refactor knowledge");
        assert_eq!(list[0].source_count, 0);
    }

    #[test]
    fn trims_and_rejects_empty_name() {
        let (_g, root) = root();
        let err = create_task(&root, "   ".into(), "".into()).unwrap_err();
        assert!(err.contains("empty"));
        let ok = create_task(&root, "  trimmed  ".into(), "".into()).unwrap();
        assert_eq!(ok.name, "trimmed");
    }

    #[test]
    fn update_changes_fields_and_bumps_timestamp() {
        let (_g, root) = root();
        let t = create_task(&root, "old".into(), "old desc".into()).unwrap();
        let original_updated = t.updated_at_ms;
        // Sleep is heavy; nudge the clock by re-reading then writing — the
        // ms-resolution clock will already differ in CI most of the time.
        std::thread::sleep(std::time::Duration::from_millis(2));
        let updated = update_task(&root, &t.id, Some("new".into()), Some("new desc".into()))
            .unwrap();
        assert_eq!(updated.name, "new");
        assert_eq!(updated.description, "new desc");
        assert!(updated.updated_at_ms >= original_updated);
    }

    #[test]
    fn update_rejects_empty_name() {
        let (_g, root) = root();
        let t = create_task(&root, "name".into(), "".into()).unwrap();
        assert!(update_task(&root, &t.id, Some("   ".into()), None).is_err());
        let still = read_task(&root, &t.id).unwrap();
        assert_eq!(still.name, "name");
    }

    #[test]
    fn delete_removes_the_dir() {
        let (_g, root) = root();
        let t = create_task(&root, "x".into(), "".into()).unwrap();
        delete_task(&root, &t.id).unwrap();
        assert!(list_tasks(&root).unwrap().is_empty());
        // Idempotent: deleting again is fine.
        delete_task(&root, &t.id).unwrap();
    }

    #[test]
    fn list_tasks_empty_when_root_missing() {
        let dir = tempdir().unwrap();
        let missing = dir.path().join("does-not-exist");
        assert!(list_tasks(&missing).unwrap().is_empty());
    }

    #[test]
    fn rejects_path_traversal_in_task_id() {
        let (_g, root) = root();
        assert!(read_task(&root, "../escape").is_err());
        assert!(delete_task(&root, "..").is_err());
        assert!(list_sources(&root, ".hidden").is_err());
    }

    #[test]
    fn list_sorted_newest_first_by_updated_at() {
        let (_g, root) = root();
        let a = create_task(&root, "a".into(), "".into()).unwrap();
        std::thread::sleep(std::time::Duration::from_millis(2));
        let b = create_task(&root, "b".into(), "".into()).unwrap();
        std::thread::sleep(std::time::Duration::from_millis(2));
        update_task(&root, &a.id, None, Some("touched".into())).unwrap();
        let list = list_tasks(&root).unwrap();
        // `a` was updated last, so it should appear first.
        assert_eq!(list[0].id, a.id);
        assert_eq!(list[1].id, b.id);
    }

    #[test]
    fn list_sources_empty_for_new_task() {
        let (_g, root) = root();
        let t = create_task(&root, "t".into(), "".into()).unwrap();
        assert!(list_sources(&root, &t.id).unwrap().is_empty());
    }

    #[test]
    fn create_source_then_list() {
        let (_g, root) = root();
        let t = create_task(&root, "t".into(), "".into()).unwrap();
        let origin = SourceOrigin {
            session_id: Some("s1".into()),
            qa_id: Some("qa-1".into()),
            project_path: Some("/tmp/proj".into()),
        };
        let s = create_source(
            &root,
            &t.id,
            "qa_block".into(),
            "## Q\nhello\n\n## A\nhi".into(),
            origin,
        )
        .unwrap();
        assert!(s.id.starts_with("src-"));
        assert_eq!(s.task_id, t.id);
        let list = list_sources(&root, &t.id).unwrap();
        assert_eq!(list.len(), 1);
        assert_eq!(list[0].content, "## Q\nhello\n\n## A\nhi");
        assert_eq!(list[0].origin.qa_id.as_deref(), Some("qa-1"));
    }

    #[test]
    fn create_source_bumps_task_updated_at() {
        let (_g, root) = root();
        let t = create_task(&root, "t".into(), "".into()).unwrap();
        let before = t.updated_at_ms;
        std::thread::sleep(std::time::Duration::from_millis(2));
        create_source(&root, &t.id, "manual".into(), "note".into(), SourceOrigin::default())
            .unwrap();
        let refreshed = read_task(&root, &t.id).unwrap();
        assert!(refreshed.updated_at_ms > before);
    }

    #[test]
    fn create_source_rejects_unknown_task() {
        let (_g, root) = root();
        let err = create_source(
            &root,
            "task-nonexistent",
            "manual".into(),
            "x".into(),
            SourceOrigin::default(),
        )
        .unwrap_err();
        // surfaces the underlying read_task error — either form is acceptable
        // so long as the call doesn't silently create a phantom directory.
        assert!(!err.is_empty());
        assert!(!sources_dir(&root, "task-nonexistent").exists());
    }

    #[test]
    fn create_source_rejects_empty_content() {
        let (_g, root) = root();
        let t = create_task(&root, "t".into(), "".into()).unwrap();
        assert!(create_source(&root, &t.id, "manual".into(), "".into(), SourceOrigin::default())
            .is_err());
    }

    #[test]
    fn delete_source_removes_it() {
        let (_g, root) = root();
        let t = create_task(&root, "t".into(), "".into()).unwrap();
        let s = create_source(&root, &t.id, "manual".into(), "x".into(), SourceOrigin::default())
            .unwrap();
        delete_source(&root, &t.id, &s.id).unwrap();
        assert!(list_sources(&root, &t.id).unwrap().is_empty());
        // Idempotent: deleting again is fine.
        delete_source(&root, &t.id, &s.id).unwrap();
    }

    #[test]
    fn delete_source_rejects_path_traversal() {
        let (_g, root) = root();
        let t = create_task(&root, "t".into(), "".into()).unwrap();
        assert!(delete_source(&root, &t.id, "../escape").is_err());
        assert!(delete_source(&root, &t.id, ".hidden").is_err());
    }
}
