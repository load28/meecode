use meecode_lib::claude_process::protocol::{
    control_response, user_text_message, PermissionBehavior,
};
use meecode_lib::claude_process::stdin_writer::{serialize_to_line, write_line};

#[test]
fn user_message_ends_with_newline_and_includes_text() {
    let line = serialize_to_line(&user_text_message("hi".into()));
    assert!(line.ends_with('\n'), "missing trailing newline: {line:?}");
    assert!(line.contains("\"type\":\"user\""));
    assert!(line.contains("\"text\":\"hi\""));
    assert_eq!(line.matches('\n').count(), 1, "exactly one newline expected");
}

#[test]
fn control_response_allow_serializes_with_tool_use_id() {
    let msg = control_response(
        "req-9".into(),
        PermissionBehavior::Allow,
        Some("tu-9".into()),
        None,
        None,
    );
    let line = serialize_to_line(&msg);
    assert!(line.contains("\"type\":\"control_response\""));
    assert!(line.contains("\"subtype\":\"success\""));
    assert!(line.contains("\"request_id\":\"req-9\""));
    assert!(line.contains("\"behavior\":\"allow\""));
    assert!(line.contains("\"toolUseID\":\"tu-9\""));
    assert!(line.ends_with('\n'));
}

#[test]
fn control_response_deny_omits_tool_use_id() {
    let msg = control_response("req-7".into(), PermissionBehavior::Deny, None, None, None);
    let line = serialize_to_line(&msg);
    assert!(line.contains("\"behavior\":\"deny\""));
    assert!(!line.contains("toolUseID"), "toolUseID should be omitted: {line}");
}

#[tokio::test]
async fn write_line_writes_serialized_bytes_to_writer() {
    let mut buf: Vec<u8> = Vec::new();
    write_line(&mut buf, &user_text_message("hello".into()))
        .await
        .expect("write_line failed");
    let s = String::from_utf8(buf).unwrap();
    assert!(s.contains("\"text\":\"hello\""));
    assert!(s.ends_with('\n'));
}
