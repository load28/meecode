//! Claude CLI session history parsing (ported from the Tauri lib).
//!
//! NOTE (M2.3b): only `projects_dir_for` is ported so far — the file explorer's
//! recent-projects/sessions list needs it. The Q&A extraction used by task
//! harvesting (`load_recent_pairs`, `extract_qa_pairs`) lands with the harvest
//! port in M2.3c.

use std::path::PathBuf;

/// Map a workspace path to its `~/.claude/projects/<dash-encoded>` directory.
pub fn projects_dir_for(project_path: &str) -> Result<PathBuf, String> {
    let home = dirs::home_dir().ok_or_else(|| "no home dir".to_string())?;
    let dash_path = project_path.replace('/', "-");
    Ok(home.join(".claude").join("projects").join(dash_path))
}
