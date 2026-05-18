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
        #[serde(default)]
        uuid: Option<String>,
    },
    Assistant {
        message: Value,
        #[serde(default)]
        session_id: Option<String>,
        #[serde(default)]
        uuid: Option<String>,
    },
    Result {
        #[serde(default)]
        subtype: Option<String>,
        #[serde(flatten)]
        rest: Value,
    },
    ControlRequest {
        request_id: String,
        request: Value,
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

/// Decoded subtype of a `control_request.request` object.
/// We only decode the shapes we care about; everything else is `Other` and gets
/// auto-replied with an error so claude does not stall.
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

/// Parse a raw `control_request.request` value into a structured body.
/// Returns the body plus the original subtype string (best-effort) so the
/// caller can include it in diagnostics or auto-replies.
pub fn decode_control_request(request: &Value) -> (ControlRequestBody, String) {
    let subtype = request
        .get("subtype")
        .and_then(|s| s.as_str())
        .unwrap_or("")
        .to_string();
    let body = serde_json::from_value::<ControlRequestBody>(request.clone())
        .unwrap_or(ControlRequestBody::Unknown);
    (body, subtype)
}

/// Messages we send to claude on stdin (line-delimited JSON, one object per line).
#[derive(Debug, Serialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum StdinMessage {
    User {
        session_id: String,
        message: UserMessageBody,
        parent_tool_use_id: Option<String>,
    },
    ControlRequest {
        request_id: String,
        request: Value,
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
    Text {
        text: String,
    },
    Image {
        source: ImageSource,
    },
}

#[derive(Debug, Serialize)]
pub struct ImageSource {
    #[serde(rename = "type")]
    pub kind: &'static str, // always "base64"
    pub media_type: String,
    pub data: String,
}

#[derive(Debug, Serialize)]
#[serde(untagged)]
pub enum ControlResponseEnvelope {
    Success {
        subtype: &'static str, // always "success"
        request_id: String,
        response: ToolPermissionResult,
    },
    Error {
        subtype: &'static str, // always "error"
        request_id: String,
        error: String,
    },
}

#[derive(Debug, Serialize)]
pub struct ToolPermissionResult {
    pub behavior: PermissionBehavior,
    #[serde(rename = "toolUseID", skip_serializing_if = "Option::is_none")]
    pub tool_use_id: Option<String>,
    #[serde(rename = "updatedInput", skip_serializing_if = "Option::is_none")]
    pub updated_input: Option<Value>,
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
        parent_tool_use_id: None,
    }
}

pub fn user_multipart_message(text: String, images: Vec<(String, String)>) -> StdinMessage {
    let mut content: Vec<UserContentBlock> = Vec::new();
    for (media_type, data) in images {
        content.push(UserContentBlock::Image {
            source: ImageSource {
                kind: "base64",
                media_type,
                data,
            },
        });
    }
    if !text.is_empty() {
        content.push(UserContentBlock::Text { text });
    }
    StdinMessage::User {
        session_id: String::new(),
        message: UserMessageBody {
            role: "user",
            content,
        },
        parent_tool_use_id: None,
    }
}

pub fn control_response(
    request_id: String,
    behavior: PermissionBehavior,
    tool_use_id: Option<String>,
    updated_input: Option<Value>,
) -> StdinMessage {
    StdinMessage::ControlResponse {
        response: ControlResponseEnvelope::Success {
            subtype: "success",
            request_id,
            response: ToolPermissionResult {
                behavior,
                tool_use_id,
                updated_input,
            },
        },
    }
}

pub fn control_request_stop_task(request_id: String) -> StdinMessage {
    StdinMessage::ControlRequest {
        request_id,
        request: serde_json::json!({ "subtype": "interrupt" }),
    }
}

pub fn control_request_set_permission_mode(request_id: String, mode: &str) -> StdinMessage {
    StdinMessage::ControlRequest {
        request_id,
        request: serde_json::json!({ "subtype": "set_permission_mode", "mode": mode }),
    }
}

pub fn control_response_error(request_id: String, error: String) -> StdinMessage {
    StdinMessage::ControlResponse {
        response: ControlResponseEnvelope::Error {
            subtype: "error",
            request_id,
            error,
        },
    }
}
