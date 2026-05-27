//! App configuration (ported verbatim from the Tauri lib's `config.rs`).
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Config {
    pub markdown_threshold: usize,
    pub claude_path: Option<String>,
}

impl Default for Config {
    fn default() -> Self {
        Self {
            markdown_threshold: 500,
            claude_path: None,
        }
    }
}

impl Config {
    pub fn config_path() -> PathBuf {
        dirs::config_dir()
            .unwrap_or_else(|| PathBuf::from("."))
            .join("meecode")
            .join("config.json")
    }

    pub fn load() -> Self {
        Self::load_from(&Self::config_path())
    }

    pub fn load_from(path: &PathBuf) -> Self {
        if !path.exists() {
            return Self::default();
        }
        let content = fs::read_to_string(path).unwrap_or_default();
        serde_json::from_str(&content).unwrap_or_default()
    }

    pub fn save(&self) -> Result<(), String> {
        self.save_to(&Self::config_path())
    }

    pub fn save_to(&self, path: &PathBuf) -> Result<(), String> {
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }
        let content = serde_json::to_string_pretty(self).map_err(|e| e.to_string())?;
        fs::write(path, content).map_err(|e| e.to_string())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    #[test]
    fn test_default_threshold() {
        let config = Config::default();
        assert_eq!(config.markdown_threshold, 500);
        assert!(config.claude_path.is_none());
    }

    #[test]
    fn test_save_and_load_roundtrip() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("config.json");
        let config = Config {
            markdown_threshold: 1000,
            claude_path: Some("custom_claude".into()),
        };
        config.save_to(&path).unwrap();
        let loaded = Config::load_from(&path);
        assert_eq!(loaded.markdown_threshold, 1000);
        assert_eq!(loaded.claude_path, Some("custom_claude".into()));
    }

    #[test]
    fn test_load_from_nonexistent_returns_default() {
        let path = PathBuf::from("/tmp/meecode_nonexistent_xyz/config.json");
        let config = Config::load_from(&path);
        assert_eq!(config.markdown_threshold, 500);
    }
}
