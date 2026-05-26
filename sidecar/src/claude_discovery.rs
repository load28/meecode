use serde::Serialize;
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::time::Duration;
use tokio::process::Command;

#[derive(Debug, Serialize, PartialEq, Eq)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum ValidationError {
    Empty,
    NotFound,
    NotExecutable,
    NoVersionResponse { stderr: String },
    Timeout,
}

const VERSION_TIMEOUT: Duration = Duration::from_secs(3);

pub fn expand_tilde(input: &str) -> String {
    if input == "~" {
        return dirs::home_dir()
            .map(|h| h.to_string_lossy().into_owned())
            .unwrap_or_else(|| input.to_string());
    }
    if let Some(rest) = input.strip_prefix("~/") {
        if let Some(home) = dirs::home_dir() {
            return home.join(rest).to_string_lossy().into_owned();
        }
    }
    input.to_string()
}

fn extra_search_dirs() -> Vec<PathBuf> {
    let mut dirs = Vec::new();
    if let Some(home) = dirs::home_dir() {
        dirs.push(home.join(".claude/local"));
        dirs.push(home.join(".npm-global/bin"));
        dirs.push(home.join(".local/bin"));
    }
    dirs.push(PathBuf::from("/opt/homebrew/bin"));
    dirs.push(PathBuf::from("/usr/local/bin"));
    dirs
}

fn build_search_paths() -> Vec<PathBuf> {
    let mut paths: Vec<PathBuf> = std::env::var_os("PATH")
        .map(|p| std::env::split_paths(&p).collect())
        .unwrap_or_default();
    for d in extra_search_dirs() {
        if !paths.contains(&d) {
            paths.push(d);
        }
    }
    paths
}

#[cfg(unix)]
fn looks_executable(path: &Path) -> bool {
    use std::os::unix::fs::PermissionsExt;
    match std::fs::metadata(path) {
        Ok(m) if m.is_file() => m.permissions().mode() & 0o111 != 0,
        _ => false,
    }
}

#[cfg(not(unix))]
fn looks_executable(path: &Path) -> bool {
    std::fs::metadata(path).map(|m| m.is_file()).unwrap_or(false)
}

pub async fn discover_claude() -> Option<String> {
    for dir in build_search_paths() {
        let cand = dir.join("claude");
        if !looks_executable(&cand) {
            continue;
        }
        if let Ok(p) = validate_claude(&cand.to_string_lossy()).await {
            return Some(p);
        }
    }
    None
}

pub async fn validate_claude(raw: &str) -> Result<String, ValidationError> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return Err(ValidationError::Empty);
    }
    let expanded = expand_tilde(trimmed);
    let path = PathBuf::from(&expanded);

    let meta = tokio::fs::metadata(&path)
        .await
        .map_err(|_| ValidationError::NotFound)?;
    if !meta.is_file() {
        return Err(ValidationError::NotFound);
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        if meta.permissions().mode() & 0o111 == 0 {
            return Err(ValidationError::NotExecutable);
        }
    }

    let mut cmd = Command::new(&path);
    cmd.arg("--version")
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true);

    let child = cmd
        .spawn()
        .map_err(|_| ValidationError::NotExecutable)?;
    let out = tokio::time::timeout(VERSION_TIMEOUT, child.wait_with_output())
        .await
        .map_err(|_| ValidationError::Timeout)?
        .map_err(|e| ValidationError::NoVersionResponse {
            stderr: e.to_string(),
        })?;

    if !out.status.success() {
        return Err(ValidationError::NoVersionResponse {
            stderr: String::from_utf8_lossy(&out.stderr).into_owned(),
        });
    }
    Ok(path.to_string_lossy().into_owned())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn expand_tilde_root() {
        let home = dirs::home_dir().unwrap();
        assert_eq!(expand_tilde("~"), home.to_string_lossy());
    }

    #[test]
    fn expand_tilde_subpath() {
        let home = dirs::home_dir().unwrap();
        assert_eq!(
            expand_tilde("~/x/y"),
            home.join("x/y").to_string_lossy()
        );
    }

    #[test]
    fn expand_tilde_no_op() {
        assert_eq!(expand_tilde("/abs/path"), "/abs/path");
        assert_eq!(expand_tilde("relative"), "relative");
    }

    #[tokio::test]
    async fn validate_empty() {
        assert_eq!(validate_claude("   ").await, Err(ValidationError::Empty));
    }

    #[tokio::test]
    async fn validate_not_found() {
        assert_eq!(
            validate_claude("/no/such/path/claude_xyz_meecode").await,
            Err(ValidationError::NotFound)
        );
    }
}
