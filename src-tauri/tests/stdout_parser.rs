use meecode_lib::claude_process::stdout_parser::{parse_str, DomainEvent};
use std::fs;

#[test]
fn parses_tool_use_fixture_emits_messages_and_session() {
    let raw = fs::read_to_string("tests/fixtures/stream-json/tool-use.jsonl").unwrap();
    let mut events = Vec::new();
    parse_str(&raw, |ev| events.push(ev));

    let messages = events
        .iter()
        .filter(|e| matches!(e, DomainEvent::Message { .. }))
        .count();
    assert!(messages > 0, "expected at least one Message event; got {events:?}");

    let session_starts = events
        .iter()
        .filter(|e| matches!(e, DomainEvent::SessionStart { .. }))
        .count();
    assert!(session_starts > 0, "expected at least one SessionStart event");
}

#[test]
fn synthetic_control_request_yields_tool_request() {
    let raw = r#"{"type":"control_request","request_id":"req-9","request":{"subtype":"can_use_tool","tool_name":"Edit","input":{"file_path":"/x.ts"},"tool_use_id":"tu-9","title":"Edit file"}}"#;
    let mut events = Vec::new();
    parse_str(raw, |ev| events.push(ev));

    assert_eq!(events.len(), 1, "expected one event; got {events:?}");
    match &events[0] {
        DomainEvent::ToolRequest {
            request_id,
            tool_name,
            tool_use_id,
            ..
        } => {
            assert_eq!(request_id, "req-9");
            assert_eq!(tool_name, "Edit");
            assert_eq!(tool_use_id.as_deref(), Some("tu-9"));
        }
        other => panic!("expected ToolRequest, got {other:?}"),
    }
}

#[test]
fn ignores_unparseable_lines() {
    let input = concat!(
        r#"{"type":"system","session_id":"s-1","subtype":"init"}"#,
        "\n",
        "not-json\n",
        r#"{"type":"assistant","message":{"role":"assistant","content":[]}}"#,
        "\n",
    );
    let mut events = Vec::new();
    parse_str(input, |ev| events.push(ev));

    let messages = events
        .iter()
        .filter(|e| matches!(e, DomainEvent::Message { .. }))
        .count();
    assert_eq!(messages, 1);
}

#[test]
fn empty_input_emits_no_events() {
    let mut events = Vec::new();
    parse_str("", |ev| events.push(ev));
    assert!(events.is_empty());
}

#[test]
fn assistant_message_carries_kind_and_uuid() {
    let raw = r#"{"type":"assistant","uuid":"u-7","session_id":"s-1","message":{"role":"assistant","content":[{"type":"text","text":"hi"}]}}"#;
    let mut events = Vec::new();
    parse_str(raw, |ev| events.push(ev));
    match events.as_slice() {
        [DomainEvent::Message { kind, uuid, body }] => {
            assert_eq!(*kind, "assistant");
            assert_eq!(uuid.as_deref(), Some("u-7"));
            assert!(body.get("content").is_some(), "body must keep content: {body:?}");
        }
        other => panic!("expected one Message; got {other:?}"),
    }
}

#[test]
fn unknown_control_request_yields_unsupported_event() {
    let raw = r#"{"type":"control_request","request_id":"req-h","request":{"subtype":"hook_callback","callback_id":"hc1"}}"#;
    let mut events = Vec::new();
    parse_str(raw, |ev| events.push(ev));
    match events.as_slice() {
        [DomainEvent::UnsupportedControlRequest { request_id, subtype_hint }] => {
            assert_eq!(request_id, "req-h");
            assert_eq!(subtype_hint, "hook_callback");
        }
        other => panic!("expected one UnsupportedControlRequest; got {other:?}"),
    }
}

#[test]
fn result_message_emits_turn_end() {
    let raw = r#"{"type":"result","subtype":"success","duration_ms":1000}"#;
    let mut events = Vec::new();
    parse_str(raw, |ev| events.push(ev));
    assert!(matches!(events.as_slice(), [DomainEvent::TurnEnd { .. }]));
}
