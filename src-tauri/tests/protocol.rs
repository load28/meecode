use meecode_lib::claude_process::protocol::{
    control_response, control_response_error, decode_control_request, user_text_message,
    ControlRequestBody, PermissionBehavior, StdinMessage, StreamMessage,
};
use std::fs;

#[test]
fn parses_basic_turn_fixture() {
    let raw = fs::read_to_string("tests/fixtures/stream-json/basic-turn.jsonl").unwrap();
    let mut parsed = 0usize;
    let mut unknown = 0usize;
    for line in raw.lines() {
        let line = line.trim();
        if line.is_empty() || !line.starts_with('{') {
            // Real claude output occasionally interleaves hook error logs as plain text.
            // Production parser will skip them; mirror that here.
            continue;
        }
        let msg: StreamMessage = serde_json::from_str(line)
            .unwrap_or_else(|e| panic!("failed to parse: {line}\nerror: {e}"));
        match msg {
            StreamMessage::Unknown => unknown += 1,
            _ => parsed += 1,
        }
    }
    assert!(parsed > 0, "fixture produced no recognized messages");
    assert_eq!(unknown, 0, "fixture had {unknown} unknown-tagged messages — extend StreamMessage");
}

#[test]
fn parses_tool_use_fixture_assistant_and_user_segments() {
    let raw = fs::read_to_string("tests/fixtures/stream-json/tool-use.jsonl").unwrap();
    let mut saw_assistant = false;
    let mut saw_user = false;
    let mut saw_result = false;
    for line in raw.lines() {
        let line = line.trim();
        if line.is_empty() || !line.starts_with('{') {
            continue;
        }
        if let Ok(msg) = serde_json::from_str::<StreamMessage>(line) {
            match msg {
                StreamMessage::Assistant { .. } => saw_assistant = true,
                StreamMessage::User { .. } => saw_user = true,
                StreamMessage::Result { .. } => saw_result = true,
                _ => {}
            }
        }
    }
    assert!(saw_assistant, "expected at least one assistant message");
    assert!(saw_user, "expected at least one user message (tool_result echo)");
    assert!(saw_result, "expected a result message at end of turn");
}

#[test]
fn parses_can_use_tool_synthetic_control_request() {
    // tool-use.jsonl was captured without --permission-prompt-tool stdio,
    // so no real control_request exists yet. Verify the type by feeding the
    // shape documented in NOTES.md.
    let raw = r#"{"type":"control_request","request_id":"req-1","request":{"subtype":"can_use_tool","tool_name":"Edit","input":{"file_path":"/x.ts"},"tool_use_id":"tu-1","title":"Edit file"}}"#;
    let msg: StreamMessage = serde_json::from_str(raw).unwrap();
    match msg {
        StreamMessage::ControlRequest { request_id, request } => {
            assert_eq!(request_id, "req-1");
            let (body, subtype) = decode_control_request(&request);
            assert_eq!(subtype, "can_use_tool");
            match body {
                ControlRequestBody::CanUseTool { tool_name, tool_use_id, .. } => {
                    assert_eq!(tool_name, "Edit");
                    assert_eq!(tool_use_id.as_deref(), Some("tu-1"));
                }
                ControlRequestBody::Unknown => panic!("expected can_use_tool subtype"),
            }
        }
        _ => panic!("expected ControlRequest variant"),
    }
}

#[test]
fn unknown_control_request_subtype_decodes_to_unknown_with_hint() {
    let raw = r#"{"type":"control_request","request_id":"req-x","request":{"subtype":"hook_callback","callback_id":"hc1"}}"#;
    let msg: StreamMessage = serde_json::from_str(raw).unwrap();
    let StreamMessage::ControlRequest { request, .. } = msg else {
        panic!("expected control_request");
    };
    let (body, subtype) = decode_control_request(&request);
    assert!(matches!(body, ControlRequestBody::Unknown));
    assert_eq!(subtype, "hook_callback");
}

#[test]
fn control_response_error_serializes_with_subtype_error() {
    let msg = control_response_error("req-x".into(), "no handler".into());
    let json = serde_json::to_string(&msg).unwrap();
    assert!(json.contains("\"subtype\":\"error\""));
    assert!(json.contains("\"request_id\":\"req-x\""));
    assert!(json.contains("\"error\":\"no handler\""));
    let _: StdinMessage = msg;
}

#[test]
fn user_text_message_serialization() {
    let msg = user_text_message("hello".into());
    let json = serde_json::to_string(&msg).unwrap();
    assert!(json.contains("\"type\":\"user\""), "missing type=user in {json}");
    assert!(json.contains("\"role\":\"user\""));
    assert!(json.contains("\"text\":\"hello\""));
}

#[test]
fn control_response_serialization_allow() {
    let msg = control_response(
        "req-1".into(),
        PermissionBehavior::Allow,
        Some("tu-1".into()),
        None,
        None,
    );
    let json = serde_json::to_string(&msg).unwrap();
    assert!(json.contains("\"type\":\"control_response\""));
    assert!(json.contains("\"subtype\":\"success\""));
    assert!(json.contains("\"request_id\":\"req-1\""));
    assert!(json.contains("\"behavior\":\"allow\""));
    assert!(json.contains("\"toolUseID\":\"tu-1\""));
}

#[test]
fn control_response_serialization_deny_without_tool_use_id() {
    let msg = control_response(
        "req-2".into(),
        PermissionBehavior::Deny,
        None,
        None,
        None,
    );
    let json = serde_json::to_string(&msg).unwrap();
    assert!(json.contains("\"behavior\":\"deny\""));
    assert!(json.contains("\"message\":\"User denied\""));
    assert!(!json.contains("toolUseID"), "toolUseID should be omitted when None: {json}");
    // Sanity check the message still has the expected wrapper.
    let _: StdinMessage = msg;
}

#[test]
fn control_response_serialization_with_updated_input() {
    let updated = serde_json::json!({"answers": {"Q1": "Yes"}});
    let msg = control_response(
        "req-3".into(),
        PermissionBehavior::Allow,
        Some("tu-3".into()),
        Some(updated),
        None,
    );
    let json = serde_json::to_string(&msg).unwrap();
    assert!(json.contains("\"updatedInput\""));
    assert!(json.contains("\"answers\":{\"Q1\":\"Yes\"}"));
}

#[test]
fn control_response_serialization_deny_with_custom_message() {
    let msg = control_response(
        "req-4".into(),
        PermissionBehavior::Deny,
        Some("tu-4".into()),
        None,
        Some("쓰기 전에 백업부터 만들어줘".into()),
    );
    let json = serde_json::to_string(&msg).unwrap();
    assert!(json.contains("\"behavior\":\"deny\""));
    assert!(json.contains("쓰기 전에 백업부터 만들어줘"));
}

#[test]
fn control_response_blank_denial_message_falls_back_to_default() {
    let msg = control_response(
        "req-5".into(),
        PermissionBehavior::Deny,
        None,
        None,
        Some("   ".into()),
    );
    let json = serde_json::to_string(&msg).unwrap();
    assert!(json.contains("\"message\":\"User denied\""));
}
