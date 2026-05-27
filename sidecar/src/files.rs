//! File-system commands (ported from the Tauri lib's `commands.rs`, tauri-free).
//! Pure path-in / value-out operations backing the file explorer and editor.

use serde::{Deserialize, Serialize};

#[derive(Deserialize)]
pub struct SearchFilesArgs {
    pub project_path: String,
    pub query: String,
}

pub fn search_files(args: SearchFilesArgs) -> Result<Vec<String>, String> {
    use std::collections::VecDeque;
    use std::fs;
    use std::path::PathBuf;

    let root = PathBuf::from(&args.project_path);
    if !root.is_dir() {
        return Ok(Vec::new());
    }
    let query = args.query.to_lowercase();
    let mut out: Vec<String> = Vec::new();
    let mut stack: VecDeque<PathBuf> = VecDeque::from([root.clone()]);
    let mut visited = 0usize;
    const MAX_VISIT: usize = 20_000;
    const MAX_RESULTS: usize = 50;
    const SKIP_DIRS: &[&str] = &[
        "node_modules", ".git", "target", "dist", "build", ".next", ".cache", ".turbo",
    ];

    while let Some(dir) = stack.pop_front() {
        if visited > MAX_VISIT || out.len() >= MAX_RESULTS {
            break;
        }
        visited += 1;
        let Ok(entries) = fs::read_dir(&dir) else {
            continue;
        };
        for entry in entries.flatten() {
            let path = entry.path();
            let name = entry.file_name().to_string_lossy().to_string();
            if name.starts_with('.') && name != ".env.example" {
                continue;
            }
            let is_dir = entry.file_type().map(|t| t.is_dir()).unwrap_or(false);
            if is_dir {
                if SKIP_DIRS.contains(&name.as_str()) {
                    continue;
                }
                stack.push_back(path);
                continue;
            }
            let rel = path
                .strip_prefix(&root)
                .ok()
                .map(|p| p.to_string_lossy().to_string())
                .unwrap_or(name.clone());
            if query.is_empty() || rel.to_lowercase().contains(&query) {
                out.push(rel);
                if out.len() >= MAX_RESULTS {
                    break;
                }
            }
        }
    }

    out.sort_by_key(|p| (p.len(), p.clone()));
    Ok(out)
}

/// One entry in a directory listing for the file-explorer tree.
#[derive(Serialize, Clone)]
pub struct DirEntry {
    pub name: String,
    pub path: String,
    pub is_dir: bool,
}

/// Reads the immediate children of `path`, directories first then
/// case-insensitive name order — the ordering IDE file trees conventionally
/// use. Everything is returned (including dotfiles and heavy dirs).
pub fn read_dir_entries(path: &str) -> Result<Vec<DirEntry>, String> {
    use std::cmp::Ordering;
    use std::fs;

    let meta = fs::metadata(path).map_err(|e| format!("metadata: {e}"))?;
    if !meta.is_dir() {
        return Err("not a directory".into());
    }
    let read = fs::read_dir(path).map_err(|e| format!("read_dir: {e}"))?;
    let mut out: Vec<DirEntry> = Vec::new();
    for entry in read.flatten() {
        let is_dir = entry.file_type().map(|t| t.is_dir()).unwrap_or(false);
        out.push(DirEntry {
            name: entry.file_name().to_string_lossy().to_string(),
            path: entry.path().to_string_lossy().to_string(),
            is_dir,
        });
    }
    out.sort_by(|a, b| match (a.is_dir, b.is_dir) {
        (true, false) => Ordering::Less,
        (false, true) => Ordering::Greater,
        _ => a.name.to_lowercase().cmp(&b.name.to_lowercase()),
    });
    Ok(out)
}

fn file_name_of(path: &str) -> String {
    std::path::Path::new(path)
        .file_name()
        .map(|s| s.to_string_lossy().to_string())
        .unwrap_or_else(|| path.to_string())
}

fn entry_for(path: &str, is_dir: bool) -> DirEntry {
    DirEntry {
        name: file_name_of(path),
        path: path.to_string(),
        is_dir,
    }
}

/// Creates an empty file or a directory at `path` (missing parents included).
/// Errors if the target already exists so an existing file is never clobbered.
pub fn create_entry(path: String, is_dir: bool) -> Result<DirEntry, String> {
    use std::fs;
    let p = std::path::Path::new(&path);
    if p.exists() {
        return Err(format!("이미 존재합니다: {}", file_name_of(&path)));
    }
    if is_dir {
        fs::create_dir_all(p).map_err(|e| format!("create_dir: {e}"))?;
    } else {
        if let Some(parent) = p.parent() {
            fs::create_dir_all(parent).map_err(|e| format!("create_dir: {e}"))?;
        }
        fs::File::create(p).map_err(|e| format!("create_file: {e}"))?;
    }
    Ok(entry_for(&path, is_dir))
}

/// Renames or moves `from` → `to`. Refuses to overwrite an existing destination
/// and refuses to move a directory into one of its own descendants.
pub fn rename_entry(from: String, to: String) -> Result<DirEntry, String> {
    use std::fs;
    let src = std::path::Path::new(&from);
    let dst = std::path::Path::new(&to);
    if !src.exists() {
        return Err("원본을 찾을 수 없습니다.".into());
    }
    if src == dst {
        return Ok(entry_for(&to, src.is_dir()));
    }
    if dst.starts_with(src) {
        return Err("폴더를 자기 자신의 하위로 이동할 수 없습니다.".into());
    }
    if dst.exists() {
        return Err(format!("이미 존재합니다: {}", file_name_of(&to)));
    }
    let is_dir = src.is_dir();
    fs::rename(src, dst).map_err(|e| format!("rename: {e}"))?;
    Ok(entry_for(&to, is_dir))
}

/// Deletes a file or directory (recursively for directories). Uses
/// `symlink_metadata` so a symlinked directory is unlinked, not followed.
pub fn delete_entry(path: String) -> Result<(), String> {
    use std::fs;
    let p = std::path::Path::new(&path);
    let meta = fs::symlink_metadata(p).map_err(|e| format!("metadata: {e}"))?;
    if meta.is_dir() {
        fs::remove_dir_all(p).map_err(|e| format!("remove_dir: {e}"))?;
    } else {
        fs::remove_file(p).map_err(|e| format!("remove_file: {e}"))?;
    }
    Ok(())
}

#[derive(Serialize)]
pub struct FileContent {
    pub path: String,
    pub content: String,
    pub language: String,
    pub size: u64,
    pub truncated: bool,
    /// Disk modification time in epoch-ms; paired with `size` it forms the
    /// editor's save-time conflict "etag".
    pub mtime_ms: u64,
}

const MAX_FILE_BYTES: u64 = 2 * 1024 * 1024;

/// Modification time of `meta` as epoch-milliseconds (0 when unavailable).
pub fn mtime_ms_of(meta: &std::fs::Metadata) -> u64 {
    meta.modified()
        .ok()
        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

fn detect_language(path: &str) -> &'static str {
    let lower = path.to_lowercase();
    let ext = lower.rsplit('.').next().unwrap_or("");
    match ext {
        "rs" => "rust",
        "ts" | "mts" | "cts" => "typescript",
        "tsx" => "tsx",
        "js" | "mjs" | "cjs" => "javascript",
        "jsx" => "jsx",
        "json" => "json",
        "html" | "htm" => "markup",
        "xml" | "svg" => "markup",
        "css" => "css",
        "scss" | "sass" => "scss",
        "py" => "python",
        "rb" => "ruby",
        "go" => "go",
        "java" => "java",
        "kt" | "kts" => "kotlin",
        "swift" => "swift",
        "c" | "h" => "c",
        "cpp" | "cc" | "cxx" | "hpp" => "cpp",
        "cs" => "csharp",
        "php" => "php",
        "sh" | "bash" | "zsh" => "bash",
        "yml" | "yaml" => "yaml",
        "toml" => "toml",
        "md" | "markdown" => "markdown",
        "sql" => "sql",
        "graphql" | "gql" => "graphql",
        _ => "plaintext",
    }
}

pub fn read_file_text(path: String) -> Result<FileContent, String> {
    use std::fs;
    let meta = fs::metadata(&path).map_err(|e| format!("metadata: {e}"))?;
    if !meta.is_file() {
        return Err("not a file".into());
    }
    let size = meta.len();
    let truncated = size > MAX_FILE_BYTES;
    let bytes = if truncated {
        let mut buf = vec![0u8; MAX_FILE_BYTES as usize];
        use std::io::Read;
        let mut f = fs::File::open(&path).map_err(|e| format!("open: {e}"))?;
        f.read_exact(&mut buf).map_err(|e| format!("read: {e}"))?;
        buf
    } else {
        fs::read(&path).map_err(|e| format!("read: {e}"))?
    };
    let content = String::from_utf8_lossy(&bytes).into_owned();
    let language = detect_language(&path).to_string();
    Ok(FileContent {
        path,
        content,
        language,
        size,
        truncated,
        mtime_ms: mtime_ms_of(&meta),
    })
}

#[derive(Serialize)]
pub struct FileStat {
    pub mtime_ms: u64,
    pub size: u64,
}

pub fn stat_file(path: String) -> Result<FileStat, String> {
    let meta = std::fs::metadata(&path).map_err(|e| format!("metadata: {e}"))?;
    if !meta.is_file() {
        return Err("not a file".into());
    }
    Ok(FileStat {
        mtime_ms: mtime_ms_of(&meta),
        size: meta.len(),
    })
}

#[derive(Deserialize)]
pub struct WriteFileArgs {
    pub path: String,
    pub content: String,
    /// Last-known disk signature; when present (and `force` is false) the write
    /// is refused if the on-disk file diverged since (dirty-write guard).
    pub expected_mtime_ms: Option<u64>,
    pub expected_size: Option<u64>,
    #[serde(default)]
    pub force: bool,
}

/// Result of a `write_file`. `Conflict` means nothing was written because the
/// on-disk file diverged from `expected_*`; the caller resolves it before retry.
#[derive(Serialize)]
#[serde(tag = "status", rename_all = "lowercase")]
pub enum WriteOutcome {
    Written { mtime_ms: u64, size: u64 },
    Conflict { mtime_ms: u64, size: u64 },
}

pub fn write_file(args: WriteFileArgs) -> Result<WriteOutcome, String> {
    use std::fs;
    if !args.force {
        if let (Some(em), Some(es)) = (args.expected_mtime_ms, args.expected_size) {
            if let Ok(meta) = fs::metadata(&args.path) {
                if meta.is_file() {
                    let cur_m = mtime_ms_of(&meta);
                    let cur_s = meta.len();
                    if cur_m != em || cur_s != es {
                        return Ok(WriteOutcome::Conflict {
                            mtime_ms: cur_m,
                            size: cur_s,
                        });
                    }
                }
            }
        }
    }
    fs::write(&args.path, args.content.as_bytes()).map_err(|e| format!("write: {e}"))?;
    let meta = fs::metadata(&args.path).map_err(|e| format!("metadata: {e}"))?;
    Ok(WriteOutcome::Written {
        mtime_ms: mtime_ms_of(&meta),
        size: meta.len(),
    })
}

pub fn open_external(path: String) -> Result<(), String> {
    use std::process::Command;
    #[cfg(target_os = "macos")]
    let prog = "open";
    #[cfg(target_os = "linux")]
    let prog = "xdg-open";
    #[cfg(target_os = "windows")]
    let prog = "explorer";
    Command::new(prog)
        .arg(&path)
        .spawn()
        .map(|_| ())
        .map_err(|e| format!("open_external failed: {e}"))
}
