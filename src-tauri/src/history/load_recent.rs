use serde::Serialize;
use serde_json::Value;
use std::path::{Path, PathBuf};
use std::time::SystemTime;

#[derive(Serialize, Clone, Debug)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum AssistantSegment {
    Text {
        text: String,
    },
    Plan {
        text: String,
    },
    Thinking {
        text: String,
    },
    ToolUse {
        id: String,
        name: String,
        summary: String,
        input: Value,
    },
    ToolResult {
        tool_use_id: String,
        text: String,
        is_error: bool,
    },
}

// PartialEq intentionally ignores raw `input` so unit tests can stay terse —
// equality semantics elsewhere only care about identity + display fields.
impl PartialEq for AssistantSegment {
    fn eq(&self, other: &Self) -> bool {
        use AssistantSegment::*;
        match (self, other) {
            (Text { text: a }, Text { text: b }) => a == b,
            (Plan { text: a }, Plan { text: b }) => a == b,
            (Thinking { text: a }, Thinking { text: b }) => a == b,
            (
                ToolUse {
                    id: i1,
                    name: n1,
                    summary: s1,
                    ..
                },
                ToolUse {
                    id: i2,
                    name: n2,
                    summary: s2,
                    ..
                },
            ) => i1 == i2 && n1 == n2 && s1 == s2,
            (
                ToolResult {
                    tool_use_id: a1,
                    text: t1,
                    is_error: e1,
                },
                ToolResult {
                    tool_use_id: a2,
                    text: t2,
                    is_error: e2,
                },
            ) => a1 == a2 && t1 == t2 && e1 == e2,
            _ => false,
        }
    }
}

#[derive(Serialize, Clone, PartialEq, Debug)]
pub struct QaPair {
    pub id: String,
    pub user_text: String,
    pub segments: Vec<AssistantSegment>,
    pub timestamp: String,
}

pub fn projects_dir_for(project_path: &str) -> Result<PathBuf, String> {
    let home = dirs::home_dir().ok_or_else(|| "no home dir".to_string())?;
    let dash_path = project_path.replace('/', "-");
    Ok(home.join(".claude").join("projects").join(dash_path))
}

pub fn load_recent_pairs(project_path: &str) -> Result<Vec<QaPair>, String> {
    let dir = projects_dir_for(project_path)?;
    if !dir.exists() {
        return Ok(Vec::new());
    }
    let entries = std::fs::read_dir(&dir).map_err(|e| e.to_string())?;
    let mut newest: Option<(PathBuf, SystemTime)> = None;
    for entry in entries.flatten() {
        let path = entry.path();
        if path.extension().and_then(|s| s.to_str()) != Some("jsonl") {
            continue;
        }
        let Ok(modified) = entry.metadata().and_then(|m| m.modified()) else {
            continue;
        };
        match &newest {
            Some((_, t)) if *t >= modified => {}
            _ => newest = Some((path, modified)),
        }
    }
    Ok(newest.map(|(p, _)| extract_qa_pairs(&p)).unwrap_or_default())
}

enum UserContent {
    Real(String),
    ToolResultOnly,
}

fn classify_user_content(content: &Value) -> UserContent {
    if let Some(s) = content.as_str() {
        return UserContent::Real(s.to_string());
    }
    let Some(arr) = content.as_array() else {
        return UserContent::Real(String::new());
    };
    let mut text = String::new();
    let mut saw_text = false;
    let mut saw_non_tool_result = false;
    for item in arr {
        let t = item.get("type").and_then(|t| t.as_str()).unwrap_or("");
        match t {
            "text" => {
                saw_text = true;
                saw_non_tool_result = true;
                if let Some(s) = item.get("text").and_then(|x| x.as_str()) {
                    if !text.is_empty() {
                        text.push('\n');
                    }
                    text.push_str(s);
                }
            }
            "tool_result" => {}
            _ => {
                saw_non_tool_result = true;
            }
        }
    }
    if !arr.is_empty() && !saw_non_tool_result {
        return UserContent::ToolResultOnly;
    }
    if saw_text {
        UserContent::Real(text)
    } else {
        UserContent::Real(String::new())
    }
}

fn summarize_tool_input(name: &str, input: &Value) -> String {
    let pick = |key: &str| -> Option<String> {
        input
            .get(key)
            .and_then(|v| v.as_str())
            .map(|s| s.to_string())
    };
    let raw = match name {
        "Bash" => pick("command").or_else(|| pick("description")),
        "Read" | "Edit" | "Write" | "NotebookEdit" => pick("file_path"),
        "Skill" => pick("skill"),
        "ToolSearch" => pick("query"),
        "Grep" | "Glob" => pick("pattern"),
        "WebFetch" | "WebSearch" => pick("url").or_else(|| pick("query")),
        "Agent" => pick("description").or_else(|| pick("subagent_type")),
        _ => input.as_object().and_then(|obj| {
            obj.values()
                .find_map(|v| v.as_str().map(|s| s.to_string()))
        }),
    };
    let s = raw.unwrap_or_default();
    let first_line = s.lines().next().unwrap_or("").trim();
    const LIMIT: usize = 120;
    if first_line.chars().count() > LIMIT {
        let truncated: String = first_line.chars().take(LIMIT).collect();
        format!("{}…", truncated)
    } else {
        first_line.to_string()
    }
}

fn assistant_segments_from_content(content: &Value) -> Vec<AssistantSegment> {
    let mut segs = Vec::new();
    if let Some(s) = content.as_str() {
        if !s.is_empty() {
            segs.push(AssistantSegment::Text {
                text: s.to_string(),
            });
        }
        return segs;
    }
    let Some(arr) = content.as_array() else {
        return segs;
    };
    for item in arr {
        let t = item.get("type").and_then(|t| t.as_str()).unwrap_or("");
        match t {
            "text" => {
                if let Some(s) = item.get("text").and_then(|x| x.as_str()) {
                    if !s.is_empty() {
                        segs.push(AssistantSegment::Text {
                            text: s.to_string(),
                        });
                    }
                }
            }
            "thinking" => {
                if let Some(s) = item.get("thinking").and_then(|x| x.as_str()) {
                    if !s.is_empty() {
                        segs.push(AssistantSegment::Thinking {
                            text: s.to_string(),
                        });
                    }
                }
            }
            "tool_use" => {
                let name = item
                    .get("name")
                    .and_then(|n| n.as_str())
                    .unwrap_or("")
                    .to_string();
                let id = item
                    .get("id")
                    .and_then(|n| n.as_str())
                    .unwrap_or("")
                    .to_string();
                if name == "ExitPlanMode" {
                    let plan = item
                        .get("input")
                        .and_then(|i| i.get("plan"))
                        .and_then(|p| p.as_str())
                        .unwrap_or("")
                        .to_string();
                    if !plan.is_empty() {
                        segs.push(AssistantSegment::Plan { text: plan });
                    }
                } else if !name.is_empty() {
                    let input = item.get("input").cloned().unwrap_or(Value::Null);
                    let summary = summarize_tool_input(&name, &input);
                    segs.push(AssistantSegment::ToolUse {
                        id,
                        name,
                        summary,
                        input,
                    });
                }
            }
            _ => {}
        }
    }
    segs
}

fn user_tool_results_from_content(content: &Value) -> Vec<AssistantSegment> {
    let mut out = Vec::new();
    let Some(arr) = content.as_array() else {
        return out;
    };
    for item in arr {
        let t = item.get("type").and_then(|t| t.as_str()).unwrap_or("");
        if t != "tool_result" {
            continue;
        }
        let tool_use_id = item
            .get("tool_use_id")
            .and_then(|s| s.as_str())
            .unwrap_or("")
            .to_string();
        let is_error = item
            .get("is_error")
            .and_then(|b| b.as_bool())
            .unwrap_or(false);
        let text = flatten_tool_result_text(item.get("content"));
        out.push(AssistantSegment::ToolResult {
            tool_use_id,
            text,
            is_error,
        });
    }
    out
}

fn flatten_tool_result_text(content: Option<&Value>) -> String {
    let Some(v) = content else {
        return String::new();
    };
    if let Some(s) = v.as_str() {
        return s.to_string();
    }
    let Some(arr) = v.as_array() else {
        return String::new();
    };
    let mut out = String::new();
    for part in arr {
        if part.get("type").and_then(|t| t.as_str()) == Some("text") {
            if let Some(s) = part.get("text").and_then(|s| s.as_str()) {
                if !out.is_empty() {
                    out.push('\n');
                }
                out.push_str(s);
            }
        }
    }
    out
}

pub fn extract_qa_pairs(path: &Path) -> Vec<QaPair> {
    let Ok(content) = std::fs::read_to_string(path) else {
        return Vec::new();
    };
    let mut pairs: Vec<QaPair> = Vec::new();
    let mut current: Option<QaPair> = None;

    for line in content.lines() {
        let line = line.trim();
        if line.is_empty() {
            continue;
        }
        let v: Value = match serde_json::from_str(line) {
            Ok(v) => v,
            Err(_) => continue,
        };
        let msg_type = v.get("type").and_then(|t| t.as_str()).unwrap_or("");
        match msg_type {
            "user" => {
                let Some(content) = v.get("message").and_then(|m| m.get("content")) else {
                    continue;
                };
                let user_text = match classify_user_content(content) {
                    UserContent::ToolResultOnly => {
                        if let Some(pair) = current.as_mut() {
                            let mut results = user_tool_results_from_content(content);
                            pair.segments.append(&mut results);
                        }
                        continue;
                    }
                    UserContent::Real(t) => t,
                };
                if user_text.is_empty() {
                    continue;
                }
                if let Some(prev) = current.take() {
                    pairs.push(prev);
                }
                let id = v
                    .get("uuid")
                    .and_then(|u| u.as_str())
                    .map(String::from)
                    .unwrap_or_else(|| format!("idx-{}", pairs.len()));
                let timestamp = v
                    .get("timestamp")
                    .and_then(|t| t.as_str())
                    .unwrap_or("")
                    .to_string();
                current = Some(QaPair {
                    id,
                    user_text,
                    segments: Vec::new(),
                    timestamp,
                });
            }
            "assistant" => {
                let Some(pair) = current.as_mut() else {
                    continue;
                };
                let Some(content) = v.get("message").and_then(|m| m.get("content")) else {
                    continue;
                };
                let mut segs = assistant_segments_from_content(content);
                if segs.is_empty() {
                    continue;
                }
                pair.segments.append(&mut segs);
            }
            _ => {}
        }
    }
    if let Some(prev) = current.take() {
        pairs.push(prev);
    }
    pairs
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;
    use tempfile::NamedTempFile;

    fn text(s: &str) -> AssistantSegment {
        AssistantSegment::Text {
            text: s.to_string(),
        }
    }
    fn plan(s: &str) -> AssistantSegment {
        AssistantSegment::Plan {
            text: s.to_string(),
        }
    }
    fn thinking(s: &str) -> AssistantSegment {
        AssistantSegment::Thinking {
            text: s.to_string(),
        }
    }
    fn tool(name: &str, summary: &str) -> AssistantSegment {
        AssistantSegment::ToolUse {
            id: String::new(),
            name: name.to_string(),
            summary: summary.to_string(),
            input: Value::Null,
        }
    }
    fn tool_with_id(id: &str, name: &str, summary: &str) -> AssistantSegment {
        AssistantSegment::ToolUse {
            id: id.to_string(),
            name: name.to_string(),
            summary: summary.to_string(),
            input: Value::Null,
        }
    }
    fn tool_result(tool_use_id: &str, text: &str, is_error: bool) -> AssistantSegment {
        AssistantSegment::ToolResult {
            tool_use_id: tool_use_id.to_string(),
            text: text.to_string(),
            is_error,
        }
    }

    #[test]
    fn projects_dir_replaces_slashes_with_dashes() {
        let dir = projects_dir_for("/Users/me/Downloads/test").unwrap();
        assert!(dir.ends_with("-Users-me-Downloads-test"));
        assert!(dir.to_string_lossy().contains(".claude/projects"));
    }

    #[test]
    fn extracts_single_qa_pair() {
        let mut file = NamedTempFile::new().unwrap();
        writeln!(file, r#"{{"type":"user","uuid":"u1","timestamp":"2026-05-18T00:00:00Z","message":{{"role":"user","content":"hi"}}}}"#).unwrap();
        writeln!(file, r#"{{"type":"assistant","uuid":"a1","timestamp":"2026-05-18T00:00:01Z","message":{{"content":[{{"type":"text","text":"hello"}}]}}}}"#).unwrap();
        let pairs = extract_qa_pairs(file.path());
        assert_eq!(pairs.len(), 1);
        assert_eq!(pairs[0].id, "u1");
        assert_eq!(pairs[0].user_text, "hi");
        assert_eq!(pairs[0].segments, vec![text("hello")]);
        assert_eq!(pairs[0].timestamp, "2026-05-18T00:00:00Z");
    }

    #[test]
    fn merges_consecutive_assistant_messages() {
        let mut file = NamedTempFile::new().unwrap();
        writeln!(file, r#"{{"type":"user","uuid":"u1","timestamp":"t","message":{{"content":"q"}}}}"#).unwrap();
        writeln!(file, r#"{{"type":"assistant","message":{{"content":[{{"type":"text","text":"first"}}]}}}}"#).unwrap();
        writeln!(file, r#"{{"type":"assistant","message":{{"content":[{{"type":"text","text":"second"}}]}}}}"#).unwrap();
        let pairs = extract_qa_pairs(file.path());
        assert_eq!(pairs.len(), 1);
        assert_eq!(pairs[0].segments, vec![text("first"), text("second")]);
    }

    #[test]
    fn skips_empty_assistant_content() {
        let mut file = NamedTempFile::new().unwrap();
        writeln!(file, r#"{{"type":"user","uuid":"u1","timestamp":"t","message":{{"content":"q"}}}}"#).unwrap();
        writeln!(file, r#"{{"type":"assistant","message":{{"content":[]}}}}"#).unwrap();
        writeln!(file, r#"{{"type":"assistant","message":{{"content":[{{"type":"text","text":"answer"}}]}}}}"#).unwrap();
        let pairs = extract_qa_pairs(file.path());
        assert_eq!(pairs.len(), 1);
        assert_eq!(pairs[0].segments, vec![text("answer")]);
    }

    #[test]
    fn multiple_turns_in_order() {
        let mut file = NamedTempFile::new().unwrap();
        writeln!(file, r#"{{"type":"user","uuid":"u1","timestamp":"t1","message":{{"content":"q1"}}}}"#).unwrap();
        writeln!(file, r#"{{"type":"assistant","message":{{"content":[{{"type":"text","text":"a1"}}]}}}}"#).unwrap();
        writeln!(file, r#"{{"type":"user","uuid":"u2","timestamp":"t2","message":{{"content":"q2"}}}}"#).unwrap();
        writeln!(file, r#"{{"type":"assistant","message":{{"content":[{{"type":"text","text":"a2"}}]}}}}"#).unwrap();
        let pairs = extract_qa_pairs(file.path());
        assert_eq!(pairs.len(), 2);
        assert_eq!(pairs[0].user_text, "q1");
        assert_eq!(pairs[0].segments, vec![text("a1")]);
        assert_eq!(pairs[1].user_text, "q2");
        assert_eq!(pairs[1].segments, vec![text("a2")]);
    }

    #[test]
    fn ignores_system_and_meta_types() {
        let mut file = NamedTempFile::new().unwrap();
        writeln!(file, r#"{{"type":"system","subtype":"x"}}"#).unwrap();
        writeln!(file, r#"{{"type":"ai-title","aiTitle":"x"}}"#).unwrap();
        writeln!(file, r#"{{"type":"user","uuid":"u1","timestamp":"t","message":{{"content":"q"}}}}"#).unwrap();
        writeln!(file, r#"{{"type":"assistant","message":{{"content":[{{"type":"text","text":"a"}}]}}}}"#).unwrap();
        let pairs = extract_qa_pairs(file.path());
        assert_eq!(pairs.len(), 1);
        assert_eq!(pairs[0].user_text, "q");
    }

    #[test]
    fn user_message_with_text_array_content() {
        let mut file = NamedTempFile::new().unwrap();
        writeln!(file, r#"{{"type":"user","uuid":"u1","timestamp":"t","message":{{"content":[{{"type":"text","text":"hello"}}]}}}}"#).unwrap();
        writeln!(file, r#"{{"type":"assistant","message":{{"content":[{{"type":"text","text":"a"}}]}}}}"#).unwrap();
        let pairs = extract_qa_pairs(file.path());
        assert_eq!(pairs.len(), 1);
        assert_eq!(pairs[0].user_text, "hello");
    }

    #[test]
    fn tool_result_messages_do_not_split_turns_and_attach_inline() {
        let mut file = NamedTempFile::new().unwrap();
        writeln!(file, r#"{{"type":"user","uuid":"u1","timestamp":"t","message":{{"content":"q"}}}}"#).unwrap();
        writeln!(file, r#"{{"type":"assistant","message":{{"content":[{{"type":"text","text":"before tool"}}]}}}}"#).unwrap();
        writeln!(file, r#"{{"type":"assistant","message":{{"content":[{{"type":"tool_use","id":"tu1","name":"Bash","input":{{"command":"ls -la"}}}}]}}}}"#).unwrap();
        writeln!(file, r#"{{"type":"user","message":{{"content":[{{"type":"tool_result","tool_use_id":"tu1","content":"file.txt"}}]}}}}"#).unwrap();
        writeln!(file, r#"{{"type":"assistant","message":{{"content":[{{"type":"text","text":"after tool"}}]}}}}"#).unwrap();
        let pairs = extract_qa_pairs(file.path());
        assert_eq!(pairs.len(), 1, "tool_result must not start a new pair");
        assert_eq!(
            pairs[0].segments,
            vec![
                text("before tool"),
                tool_with_id("tu1", "Bash", "ls -la"),
                tool_result("tu1", "file.txt", false),
                text("after tool"),
            ]
        );
    }

    #[test]
    fn tool_result_with_array_content_concatenates_text_parts() {
        let mut file = NamedTempFile::new().unwrap();
        writeln!(file, r#"{{"type":"user","uuid":"u1","timestamp":"t","message":{{"content":"q"}}}}"#).unwrap();
        writeln!(file, r#"{{"type":"assistant","message":{{"content":[{{"type":"tool_use","id":"tu1","name":"Read","input":{{"file_path":"/a"}}}}]}}}}"#).unwrap();
        writeln!(file, r##"{{"type":"user","message":{{"content":[{{"type":"tool_result","tool_use_id":"tu1","content":[{{"type":"text","text":"line1"}},{{"type":"text","text":"line2"}}]}}]}}}}"##).unwrap();
        let pairs = extract_qa_pairs(file.path());
        assert_eq!(
            pairs[0].segments,
            vec![
                tool_with_id("tu1", "Read", "/a"),
                tool_result("tu1", "line1\nline2", false),
            ]
        );
    }

    #[test]
    fn tool_result_with_is_error_true_is_preserved() {
        let mut file = NamedTempFile::new().unwrap();
        writeln!(file, r#"{{"type":"user","uuid":"u1","timestamp":"t","message":{{"content":"q"}}}}"#).unwrap();
        writeln!(file, r#"{{"type":"assistant","message":{{"content":[{{"type":"tool_use","id":"tu1","name":"Bash","input":{{"command":"oops"}}}}]}}}}"#).unwrap();
        writeln!(file, r#"{{"type":"user","message":{{"content":[{{"type":"tool_result","tool_use_id":"tu1","content":"command not found","is_error":true}}]}}}}"#).unwrap();
        let pairs = extract_qa_pairs(file.path());
        assert_eq!(
            pairs[0].segments,
            vec![
                tool_with_id("tu1", "Bash", "oops"),
                tool_result("tu1", "command not found", true),
            ]
        );
    }

    #[test]
    fn captures_exit_plan_mode_as_plan_segment() {
        let mut file = NamedTempFile::new().unwrap();
        writeln!(file, r##"{{"type":"user","uuid":"u1","timestamp":"t","message":{{"content":"plan please"}}}}"##).unwrap();
        writeln!(file, r##"{{"type":"assistant","message":{{"content":[{{"type":"tool_use","name":"ExitPlanMode","input":{{"plan":"# Plan\n\nstep 1"}}}}]}}}}"##).unwrap();
        let pairs = extract_qa_pairs(file.path());
        assert_eq!(pairs.len(), 1);
        assert_eq!(pairs[0].segments, vec![plan("# Plan\n\nstep 1")]);
    }

    #[test]
    fn tool_use_summary_truncates_to_first_line() {
        let mut file = NamedTempFile::new().unwrap();
        writeln!(file, r#"{{"type":"user","uuid":"u1","timestamp":"t","message":{{"content":"q"}}}}"#).unwrap();
        writeln!(file, r#"{{"type":"assistant","message":{{"content":[{{"type":"tool_use","name":"Bash","input":{{"command":"echo line1\necho line2"}}}}]}}}}"#).unwrap();
        let pairs = extract_qa_pairs(file.path());
        assert_eq!(pairs[0].segments, vec![tool("Bash", "echo line1")]);
    }

    #[test]
    fn extracts_thinking_segment() {
        let mut file = NamedTempFile::new().unwrap();
        writeln!(file, r#"{{"type":"user","uuid":"u1","timestamp":"t","message":{{"content":"q"}}}}"#).unwrap();
        writeln!(file, r##"{{"type":"assistant","message":{{"content":[{{"type":"thinking","thinking":"reasoning..."}},{{"type":"text","text":"answer"}}]}}}}"##).unwrap();
        let pairs = extract_qa_pairs(file.path());
        assert_eq!(pairs.len(), 1);
        assert_eq!(
            pairs[0].segments,
            vec![thinking("reasoning..."), text("answer")]
        );
    }

    #[test]
    fn empty_thinking_is_dropped() {
        let mut file = NamedTempFile::new().unwrap();
        writeln!(file, r#"{{"type":"user","uuid":"u1","timestamp":"t","message":{{"content":"q"}}}}"#).unwrap();
        writeln!(file, r##"{{"type":"assistant","message":{{"content":[{{"type":"thinking","thinking":""}},{{"type":"text","text":"answer"}}]}}}}"##).unwrap();
        let pairs = extract_qa_pairs(file.path());
        assert_eq!(pairs[0].segments, vec![text("answer")]);
    }

    #[test]
    fn tool_use_summary_picks_known_field_per_tool() {
        let cases: Vec<(&str, &str, &str)> = vec![
            (r#"{"file_path":"/x/y.rs"}"#, "Read", "/x/y.rs"),
            (r#"{"skill":"brainstorming"}"#, "Skill", "brainstorming"),
            (r#"{"query":"select:Read"}"#, "ToolSearch", "select:Read"),
        ];
        for (input, name, want) in cases {
            let mut file = NamedTempFile::new().unwrap();
            writeln!(file, r#"{{"type":"user","uuid":"u1","timestamp":"t","message":{{"content":"q"}}}}"#).unwrap();
            writeln!(
                file,
                r#"{{"type":"assistant","message":{{"content":[{{"type":"tool_use","name":"{}","input":{}}}]}}}}"#,
                name, input
            )
            .unwrap();
            let pairs = extract_qa_pairs(file.path());
            assert_eq!(pairs[0].segments, vec![tool(name, want)], "case {}", name);
        }
    }
}
