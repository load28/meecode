use crate::pins::{list_pins, list_wiki_files, read_wiki_file};
use serde::Serialize;
use serde_json::Value;

#[derive(Debug, Clone, Serialize)]
pub struct WikiDiffEntry {
    pub name: String,
    pub old_content: String,
    pub new_content: String,
}

pub fn build_prompt(project_path: &str) -> Result<String, String> {
    let pins = list_pins(project_path)?;
    let wiki = list_wiki_files(project_path)?;

    let mut prompt = String::new();
    prompt.push_str(
        "You are organizing scattered notes (pins) into a project wiki for a human reader. \
Your job is to consolidate the pins below into a coherent set of markdown wiki files.\n\n",
    );

    prompt.push_str("# Pins (raw scrapbook collected from chat sessions)\n\n");
    if pins.is_empty() {
        prompt.push_str("(no pins yet)\n\n");
    } else {
        for pin in &pins {
            prompt.push_str(&format!(
                "## [^{marker}] · kind={kind} · session={sess}\n\n{text}\n\n",
                marker = pin.marker,
                kind = pin.segment_kind,
                sess = pin.session_id.as_deref().unwrap_or("?"),
                text = pin.text,
            ));
        }
    }

    prompt.push_str("# Existing wiki files\n\n");
    if wiki.is_empty() {
        prompt.push_str("(no wiki files yet — create them from scratch)\n\n");
    } else {
        for f in &wiki {
            let content = read_wiki_file(project_path, &f.name).unwrap_or_default();
            prompt.push_str(&format!(
                "## {name}\n\n```markdown\n{content}\n```\n\n",
                name = f.name,
                content = content,
            ));
        }
    }

    prompt.push_str(
        r##"# Output rules — read carefully

1. Output ONLY the wiki files in this exact format. No preamble, no commentary, no closing remarks:

<wiki-file path="decisions.md">
...the complete new contents of decisions.md...
</wiki-file>

<wiki-file path="architecture.md">
...the complete new contents of architecture.md...
</wiki-file>

2. Use kebab-case `.md` file names grouped by topic, e.g. `decisions.md`, `architecture.md`, `glossary.md`, `gotchas.md`, `workflows.md`. Pick whatever categories fit the pins. Keep it under ~6 files.

3. Merge related pins into coherent prose. Do NOT just list quotes — write a wiki, not a transcript.

4. **Every pin's footnote marker `[^pin-N]` MUST appear in the output** next to the sentence/claim that came from it. Existing markers must be preserved; new pins get their marker placed next to their content. This is how the reader traces a fact back to its source.

5. Do NOT use ANY tools (no Read, Edit, Write, Bash, etc). Everything you need is in this prompt.

6. Each `<wiki-file>` block contains the FULL new contents of that file (not a diff).

7. If an existing wiki file is no longer useful, omit it from your output (the user will be asked whether to delete it).

Begin now.
"##,
    );

    Ok(prompt)
}

pub fn parse_wiki_response(text: &str) -> Vec<(String, String)> {
    let mut out: Vec<(String, String)> = Vec::new();
    let open_tag = "<wiki-file path=\"";
    let close_tag = "</wiki-file>";
    let mut cursor = 0usize;
    while cursor < text.len() {
        let Some(rel_start) = text[cursor..].find(open_tag) else {
            break;
        };
        let path_start = cursor + rel_start + open_tag.len();
        let Some(quote_end_rel) = text[path_start..].find('"') else {
            break;
        };
        let path = text[path_start..path_start + quote_end_rel].to_string();
        let after_quote = path_start + quote_end_rel + 1;
        let Some(gt_rel) = text[after_quote..].find('>') else {
            break;
        };
        let content_start = after_quote + gt_rel + 1;
        let Some(close_rel) = text[content_start..].find(close_tag) else {
            break;
        };
        let raw = &text[content_start..content_start + close_rel];
        let cleaned = raw.trim_start_matches('\n').trim_end().to_string();
        if !path.is_empty() {
            out.push((path, cleaned));
        }
        cursor = content_start + close_rel + close_tag.len();
    }
    out
}

pub fn extract_assistant_text(body: &Value) -> String {
    let Some(content) = body.get("content") else {
        return String::new();
    };
    if let Some(s) = content.as_str() {
        return s.to_string();
    }
    let Some(arr) = content.as_array() else {
        return String::new();
    };
    let mut out = String::new();
    for item in arr {
        if item.get("type").and_then(|t| t.as_str()) == Some("text") {
            if let Some(s) = item.get("text").and_then(|s| s.as_str()) {
                out.push_str(s);
            }
        }
    }
    out
}

pub fn diff_entries(project_path: &str, parsed: &[(String, String)]) -> Vec<WikiDiffEntry> {
    parsed
        .iter()
        .map(|(name, new_content)| {
            let old = read_wiki_file(project_path, name).unwrap_or_default();
            WikiDiffEntry {
                name: name.clone(),
                old_content: old,
                new_content: new_content.clone(),
            }
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    #[test]
    fn parse_single_wiki_file_block() {
        let raw = "<wiki-file path=\"decisions.md\">\n# Decisions\n\nfirst line [^pin-1]\n</wiki-file>";
        let parsed = parse_wiki_response(raw);
        assert_eq!(parsed.len(), 1);
        assert_eq!(parsed[0].0, "decisions.md");
        assert_eq!(parsed[0].1, "# Decisions\n\nfirst line [^pin-1]");
    }

    #[test]
    fn parse_multiple_wiki_file_blocks() {
        let raw = r##"<wiki-file path="a.md">
content a
</wiki-file>

some noise that should be ignored

<wiki-file path="b.md">
content b
line 2
</wiki-file>"##;
        let parsed = parse_wiki_response(raw);
        assert_eq!(parsed.len(), 2);
        assert_eq!(parsed[0], ("a.md".to_string(), "content a".to_string()));
        assert_eq!(parsed[1], ("b.md".to_string(), "content b\nline 2".to_string()));
    }

    #[test]
    fn parse_empty_when_no_blocks() {
        assert_eq!(parse_wiki_response("nothing here").len(), 0);
        assert_eq!(parse_wiki_response("").len(), 0);
    }

    #[test]
    fn parse_unclosed_block_is_skipped() {
        let raw = "<wiki-file path=\"x.md\">\nbroken";
        assert_eq!(parse_wiki_response(raw).len(), 0);
    }

    #[test]
    fn build_prompt_with_no_pins_no_wiki() {
        let dir = tempdir().unwrap();
        let project = dir.path().to_string_lossy().to_string();
        let prompt = build_prompt(&project).unwrap();
        assert!(prompt.contains("no pins yet"));
        assert!(prompt.contains("no wiki files yet"));
        assert!(prompt.contains("<wiki-file path="));
        assert!(prompt.contains("[^pin-N]"));
    }

    #[test]
    fn build_prompt_includes_pin_marker_and_text() {
        let dir = tempdir().unwrap();
        let project = dir.path().to_string_lossy().to_string();
        crate::pins::append_pin(
            &project,
            Some("sess-abc".into()),
            Some("qa-1".into()),
            "text".into(),
            "important fact about X".into(),
        )
        .unwrap();
        let prompt = build_prompt(&project).unwrap();
        assert!(prompt.contains("[^pin-1]"));
        assert!(prompt.contains("important fact about X"));
        assert!(prompt.contains("session=sess-abc"));
    }

    #[test]
    fn extract_text_from_string_content() {
        let body = serde_json::json!({ "content": "hello" });
        assert_eq!(extract_assistant_text(&body), "hello");
    }

    #[test]
    fn extract_text_from_array_content() {
        let body = serde_json::json!({
            "content": [
                { "type": "text", "text": "part 1" },
                { "type": "thinking", "thinking": "private" },
                { "type": "text", "text": " part 2" },
            ]
        });
        assert_eq!(extract_assistant_text(&body), "part 1 part 2");
    }

    #[test]
    fn extract_text_empty_when_no_content() {
        assert_eq!(extract_assistant_text(&serde_json::json!({})), "");
    }

    #[test]
    fn diff_entries_pairs_old_and_new() {
        let dir = tempdir().unwrap();
        let project = dir.path().to_string_lossy().to_string();
        crate::pins::write_wiki_file(&project, "decisions.md", "old body").unwrap();
        let parsed = vec![
            ("decisions.md".to_string(), "new body".to_string()),
            ("brand-new.md".to_string(), "fresh".to_string()),
        ];
        let entries = diff_entries(&project, &parsed);
        assert_eq!(entries.len(), 2);
        assert_eq!(entries[0].name, "decisions.md");
        assert_eq!(entries[0].old_content, "old body");
        assert_eq!(entries[0].new_content, "new body");
        assert_eq!(entries[1].old_content, "");
        assert_eq!(entries[1].new_content, "fresh");
    }
}
