use crate::claude_process::protocol::{ControlRequestBody, StreamMessage};
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
        StreamMessage::ControlRequest { request_id, request } => match request {
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
            ControlRequestBody::Unknown => return None,
        },
        StreamMessage::Result { rest, subtype } => DomainEvent::TurnEnd {
            raw: serde_json::json!({ "subtype": subtype, "rest": rest }),
        },
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
