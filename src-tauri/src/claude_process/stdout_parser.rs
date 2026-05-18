use crate::claude_process::protocol::{decode_control_request, ControlRequestBody, StreamMessage};
use serde_json::Value;
use tokio::io::{AsyncBufReadExt, AsyncRead, BufReader};

#[derive(Debug)]
pub enum DomainEvent {
    SessionStart {
        session_id: String,
    },
    Message {
        kind: &'static str,
        uuid: Option<String>,
        body: Value,
    },
    ToolRequest {
        request_id: String,
        tool_name: String,
        input: Value,
        tool_use_id: Option<String>,
    },
    UnsupportedControlRequest {
        request_id: String,
        subtype_hint: String,
    },
    HookActivity {
        hook_name: String,
        phase: String,
    },
    CompactBoundary,
    SessionInit {
        session_id: Option<String>,
        slash_commands: Vec<Value>,
        model: Option<String>,
        permission_mode: Option<String>,
    },
    RateLimit {
        raw: Value,
    },
    ControlCancel {
        request_id: String,
    },
    TurnEnd {
        raw: Value,
    },
}

fn parse_one(line: &str) -> Option<DomainEvent> {
    let trimmed = line.trim();
    if trimmed.is_empty() || !trimmed.starts_with('{') {
        return None;
    }
    let msg: StreamMessage = serde_json::from_str(trimmed).ok()?;
    Some(match msg {
        StreamMessage::System {
            subtype: Some(ref sub),
            ..
        } if sub == "compact_boundary" => DomainEvent::CompactBoundary,
        StreamMessage::System {
            subtype: Some(ref sub),
            ref rest,
            ..
        } if sub == "hook_started" || sub == "hook_response" || sub == "hook_progress" => {
            let hook_name = rest
                .get("hook_name")
                .and_then(|s| s.as_str())
                .unwrap_or("")
                .to_string();
            DomainEvent::HookActivity {
                hook_name,
                phase: sub.clone(),
            }
        }
        StreamMessage::System {
            subtype: Some(ref sub),
            session_id,
            ref rest,
        } if sub == "init" => {
            let slash_commands = rest
                .get("slash_commands")
                .and_then(|v| v.as_array())
                .cloned()
                .unwrap_or_default();
            let model = rest
                .get("model")
                .and_then(|v| v.as_str())
                .map(String::from);
            let permission_mode = rest
                .get("permissionMode")
                .and_then(|v| v.as_str())
                .map(String::from);
            DomainEvent::SessionInit {
                session_id,
                slash_commands,
                model,
                permission_mode,
            }
        }
        StreamMessage::System {
            session_id: Some(id),
            ..
        } => DomainEvent::SessionStart { session_id: id },
        StreamMessage::Assistant { message, uuid, .. } => DomainEvent::Message {
            kind: "assistant",
            uuid,
            body: message,
        },
        StreamMessage::User { message, uuid, .. } => DomainEvent::Message {
            kind: "user",
            uuid,
            body: message,
        },
        StreamMessage::ControlRequest { request_id, request } => {
            let (body, subtype) = decode_control_request(&request);
            match body {
                ControlRequestBody::CanUseTool {
                    tool_name,
                    input,
                    tool_use_id,
                    ..
                } => DomainEvent::ToolRequest {
                    request_id,
                    tool_name,
                    input,
                    tool_use_id,
                },
                ControlRequestBody::Unknown => DomainEvent::UnsupportedControlRequest {
                    request_id,
                    subtype_hint: subtype,
                },
            }
        }
        StreamMessage::Result { rest, subtype } => DomainEvent::TurnEnd {
            raw: serde_json::json!({ "subtype": subtype, "rest": rest }),
        },
        StreamMessage::RateLimitEvent { rest } => DomainEvent::RateLimit { raw: rest },
        StreamMessage::ControlCancelRequest { request_id } => {
            DomainEvent::ControlCancel { request_id }
        }
        _ => return None,
    })
}

pub fn parse_str(input: &str, mut emit: impl FnMut(DomainEvent)) {
    for line in input.lines() {
        if let Some(ev) = parse_one(line) {
            emit(ev);
        }
    }
}

pub async fn parse_reader<R: AsyncRead + Unpin>(reader: R, mut emit: impl FnMut(DomainEvent)) {
    let mut buf = BufReader::new(reader);
    let mut line = String::new();
    loop {
        line.clear();
        match buf.read_line(&mut line).await {
            Ok(0) => break,
            Ok(_) => {
                if let Some(ev) = parse_one(&line) {
                    emit(ev);
                }
            }
            Err(_) => break,
        }
    }
}
