use serde::{Deserialize, Serialize};
use serde_json::Value;

/// Top-level message types observed on `claude --output-format stream-json` stdout.
/// See `src-tauri/tests/fixtures/stream-json/NOTES.md` for the authoritative schema.
#[derive(Debug, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum StreamMessage {
    System {
        #[serde(default)]
        subtype: Option<String>,
        #[serde(default)]
        session_id: Option<String>,
        #[serde(flatten)]
        rest: Value,
    },
    User {
        message: Value,
        #[serde(default)]
        session_id: Option<String>,
    },
    Assistant {
        message: Value,
        #[serde(default)]
        session_id: Option<String>,
    },
    Result {
        #[serde(default)]
        subtype: Option<String>,
        #[serde(flatten)]
        rest: Value,
    },
    ControlRequest {
        request_id: String,
        request: ControlRequestBody,
    },
    ControlResponse {
        #[serde(default)]
        response: Value,
    },
    ControlCancelRequest {
        request_id: String,
    },
    KeepAlive,
    TranscriptMirror {
        #[serde(flatten)]
        rest: Value,
    },
    RateLimitEvent {
        #[serde(flatten)]
        rest: Value,
    },
    #[serde(other)]
    Unknown,
}

#[derive(Debug, Deserialize)]
#[serde(tag = "subtype", rename_all = "snake_case")]
pub enum ControlRequestBody {
    CanUseTool {
        tool_name: String,
        input: Value,
        #[serde(default)]
        tool_use_id: Option<String>,
        #[serde(default)]
        permission_suggestions: Option<Value>,
        #[serde(default)]
        blocked_path: Option<String>,
        #[serde(default)]
        decision_reason: Option<String>,
        #[serde(default)]
        title: Option<String>,
        #[serde(default)]
        display_name: Option<String>,
        #[serde(default)]
        description: Option<String>,
    },
    #[serde(other)]
    Unknown,
}

/// Messages we send to claude on stdin (line-delimited JSON, one object per line).
#[derive(Debug, Serialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum StdinMessage {
    User {
        session_id: String,
        message: UserMessageBody,
    },
    ControlResponse {
        response: ControlResponseEnvelope,
    },
}

#[derive(Debug, Serialize)]
pub struct UserMessageBody {
    pub role: &'static str,
    pub content: Vec<UserContentBlock>,
}

#[derive(Debug, Serialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum UserContentBlock {
    Text { text: String },
}

#[derive(Debug, Serialize)]
pub struct ControlResponseEnvelope {
    pub subtype: &'static str, // "success"
    pub request_id: String,
    pub response: ToolPermissionResult,
}

#[derive(Debug, Serialize)]
pub struct ToolPermissionResult {
    pub behavior: PermissionBehavior,
    #[serde(rename = "toolUseID", skip_serializing_if = "Option::is_none")]
    pub tool_use_id: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum PermissionBehavior {
    Allow,
    Deny,
}

pub fn user_text_message(text: String) -> StdinMessage {
    StdinMessage::User {
        session_id: String::new(),
        message: UserMessageBody {
            role: "user",
            content: vec![UserContentBlock::Text { text }],
        },
    }
}

pub fn control_response(
    request_id: String,
    behavior: PermissionBehavior,
    tool_use_id: Option<String>,
) -> StdinMessage {
    StdinMessage::ControlResponse {
        response: ControlResponseEnvelope {
            subtype: "success",
            request_id,
            response: ToolPermissionResult {
                behavior,
                tool_use_id,
            },
        },
    }
}
