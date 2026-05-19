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
        parent_tool_use_id: Option<String>,
    },
    /// Raw Anthropic SSE delta. Forwarded verbatim so the frontend
    /// assembler can run `message_start` / `content_block_*` / `message_stop`
    /// and live-render thinking/text without waiting for the aggregated
    /// `assistant` message.
    StreamEvent {
        event: Value,
        parent_tool_use_id: Option<String>,
    },
    /// Long-running-tool heartbeat. `tool_use_id` lets the UI attach the
    /// progress to the right tool card.
    ToolProgress {
        raw: Value,
    },
    /// `system:task_started` / `task_progress` / `task_notification` emitted
    /// for background tasks (Agent run in background, long Bash, Monitor).
    TaskActivity {
        subtype: String,
        raw: Value,
    },
    ToolRequest {
        request_id: String,
        tool_name: String,
        input: Value,
        tool_use_id: Option<String>,
        permission_suggestions: Option<Value>,
        decision_reason: Option<String>,
        blocked_path: Option<String>,
        title: Option<String>,
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
        cwd: Option<String>,
        mcp_servers: Vec<Value>,
        agents: Vec<Value>,
        tools: Vec<Value>,
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
            ref rest,
            ..
        } if sub == "task_started" || sub == "task_progress" || sub == "task_notification" => {
            DomainEvent::TaskActivity {
                subtype: sub.clone(),
                raw: rest.clone(),
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
            let cwd = rest
                .get("cwd")
                .and_then(|v| v.as_str())
                .map(String::from);
            let mcp_servers = rest
                .get("mcp_servers")
                .and_then(|v| v.as_array())
                .cloned()
                .unwrap_or_default();
            let agents = rest
                .get("agents")
                .and_then(|v| v.as_array())
                .cloned()
                .unwrap_or_default();
            let tools = rest
                .get("tools")
                .and_then(|v| v.as_array())
                .cloned()
                .unwrap_or_default();
            DomainEvent::SessionInit {
                session_id,
                slash_commands,
                model,
                permission_mode,
                cwd,
                mcp_servers,
                agents,
                tools,
            }
        }
        StreamMessage::System {
            session_id: Some(id),
            ..
        } => DomainEvent::SessionStart { session_id: id },
        StreamMessage::Assistant {
            message,
            uuid,
            parent_tool_use_id,
            ..
        } => DomainEvent::Message {
            kind: "assistant",
            uuid,
            body: message,
            parent_tool_use_id,
        },
        StreamMessage::User {
            message,
            uuid,
            parent_tool_use_id,
            ..
        } => DomainEvent::Message {
            kind: "user",
            uuid,
            body: message,
            parent_tool_use_id,
        },
        StreamMessage::StreamEvent {
            event,
            parent_tool_use_id,
            ..
        } => DomainEvent::StreamEvent {
            event,
            parent_tool_use_id,
        },
        StreamMessage::ToolProgress { rest } => DomainEvent::ToolProgress { raw: rest },
        StreamMessage::ControlRequest { request_id, request } => {
            let (body, subtype) = decode_control_request(&request);
            match body {
                ControlRequestBody::CanUseTool {
                    tool_name,
                    input,
                    tool_use_id,
                    permission_suggestions,
                    decision_reason,
                    blocked_path,
                    title,
                    ..
                } => DomainEvent::ToolRequest {
                    request_id,
                    tool_name,
                    input,
                    tool_use_id,
                    permission_suggestions,
                    decision_reason,
                    blocked_path,
                    title,
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
