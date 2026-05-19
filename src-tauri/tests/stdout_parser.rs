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

    let session_inits = events
        .iter()
        .filter(|e| {
            matches!(
                e,
                DomainEvent::SessionStart { .. } | DomainEvent::SessionInit { .. }
            )
        })
        .count();
    assert!(
        session_inits > 0,
        "expected at least one SessionStart/SessionInit event"
    );
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
        [DomainEvent::Message { kind, uuid, body, .. }] => {
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

#[test]
fn stream_event_with_content_block_delta_passes_through() {
    let raw = r#"{"type":"stream_event","event":{"type":"content_block_delta","index":0,"delta":{"type":"thinking_delta","thinking":"음 "}},"parent_tool_use_id":null,"uuid":"u-1","session_id":"s-1"}"#;
    let mut events = Vec::new();
    parse_str(raw, |ev| events.push(ev));
    match events.as_slice() {
        [DomainEvent::StreamEvent {
            event,
            parent_tool_use_id,
        }] => {
            assert!(parent_tool_use_id.is_none());
            assert_eq!(
                event.get("type").and_then(|v| v.as_str()),
                Some("content_block_delta")
            );
            assert_eq!(
                event
                    .get("delta")
                    .and_then(|v| v.get("thinking"))
                    .and_then(|v| v.as_str()),
                Some("음 ")
            );
        }
        other => panic!("expected one StreamEvent; got {other:?}"),
    }
}

#[test]
fn assistant_with_parent_tool_use_id_carries_it_through() {
    let raw = r#"{"type":"assistant","uuid":"u-c","parent_tool_use_id":"tu-parent","message":{"role":"assistant","content":[{"type":"text","text":"sub"}]}}"#;
    let mut events = Vec::new();
    parse_str(raw, |ev| events.push(ev));
    match events.as_slice() {
        [DomainEvent::Message {
            kind,
            parent_tool_use_id,
            ..
        }] => {
            assert_eq!(*kind, "assistant");
            assert_eq!(parent_tool_use_id.as_deref(), Some("tu-parent"));
        }
        other => panic!("expected Message; got {other:?}"),
    }
}

#[test]
fn task_started_emits_task_activity() {
    let raw = r#"{"type":"system","subtype":"task_started","task_id":"t-1","description":"explore","task_type":"local_agent","uuid":"u-x","session_id":"s-1"}"#;
    let mut events = Vec::new();
    parse_str(raw, |ev| events.push(ev));
    match events.as_slice() {
        [DomainEvent::TaskActivity { subtype, raw }] => {
            assert_eq!(subtype, "task_started");
            assert_eq!(raw.get("task_id").and_then(|v| v.as_str()), Some("t-1"));
            assert_eq!(
                raw.get("task_type").and_then(|v| v.as_str()),
                Some("local_agent")
            );
        }
        other => panic!("expected TaskActivity; got {other:?}"),
    }
}

#[test]
fn tool_progress_is_forwarded() {
    let raw = r#"{"type":"tool_progress","tool_use_id":"tu-x","tool_name":"Bash","elapsed_time_seconds":3.5}"#;
    let mut events = Vec::new();
    parse_str(raw, |ev| events.push(ev));
    match events.as_slice() {
        [DomainEvent::ToolProgress { raw }] => {
            assert_eq!(
                raw.get("tool_use_id").and_then(|v| v.as_str()),
                Some("tu-x")
            );
            assert_eq!(raw.get("tool_name").and_then(|v| v.as_str()), Some("Bash"));
        }
        other => panic!("expected ToolProgress; got {other:?}"),
    }
}
