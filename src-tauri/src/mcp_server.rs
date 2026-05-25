//! Minimal stdio MCP server exposing MeeCode's Task context as a tool.
//!
//! The main binary re-execs itself as `meecode mcp-stdio` (see `main.rs`).
//! The Claude Code CLI, configured via `--mcp-config`, spawns that command
//! and speaks MCP over stdio: newline-delimited JSON-RPC 2.0 messages, one
//! per line. We implement just enough of the protocol for a single tool:
//!
//! - `initialize`            → advertise the `tools` capability
//! - `tools/list`            → describe `load_task_context`
//! - `tools/call`            → read the Task from disk and return its markdown
//! - `ping`                  → empty result
//! - `notifications/*`       → silently acknowledged (no response)
//!
//! Hand-rolled (vs. pulling in an MCP SDK) to keep zero extra dependencies
//! and a lean release binary. stdout is reserved for protocol frames; all
//! logging goes to stderr.

use serde_json::{json, Value};
use std::io::{BufRead, Write};

use crate::tasks;

/// Tool name as the model sees it after the `mcp__<server>__` prefix the CLI
/// adds: `mcp__meecode__load_task_context`. Keep in sync with the server name
/// in the generated `--mcp-config` and the frontend constant.
const TOOL_NAME: &str = "load_task_context";

/// Echoed back when the client doesn't send a protocolVersion (it always
/// does in practice; this is just a defensive default).
const DEFAULT_PROTOCOL: &str = "2025-06-18";

/// Blocking read/respond loop over stdio. Returns when stdin closes.
pub fn run_stdio() {
    let stdin = std::io::stdin();
    let stdout = std::io::stdout();
    let mut out = stdout.lock();
    for line in stdin.lock().lines() {
        let line = match line {
            Ok(l) => l,
            Err(_) => break,
        };
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }
        let req: Value = match serde_json::from_str(trimmed) {
            Ok(v) => v,
            Err(e) => {
                eprintln!("[meecode-mcp] ignoring malformed request: {e}");
                continue;
            }
        };
        let id = req.get("id").cloned();
        let method = req.get("method").and_then(|m| m.as_str()).unwrap_or("");
        if let Some(resp) = handle(method, req.get("params"), id) {
            match serde_json::to_string(&resp) {
                Ok(s) => {
                    if writeln!(out, "{s}").is_err() {
                        break;
                    }
                    let _ = out.flush();
                }
                Err(e) => eprintln!("[meecode-mcp] failed to serialize response: {e}"),
            }
        }
    }
}

/// Returns `None` for notifications (messages without an `id`), which must
/// not be answered per JSON-RPC.
fn handle(method: &str, params: Option<&Value>, id: Option<Value>) -> Option<Value> {
    match method {
        "initialize" => {
            let protocol = params
                .and_then(|p| p.get("protocolVersion"))
                .and_then(|v| v.as_str())
                .unwrap_or(DEFAULT_PROTOCOL);
            Some(result(
                id,
                json!({
                    "protocolVersion": protocol,
                    "capabilities": { "tools": {} },
                    "serverInfo": {
                        "name": "meecode",
                        "version": env!("CARGO_PKG_VERSION"),
                    },
                }),
            ))
        }
        "tools/list" => Some(result(id, json!({ "tools": [tool_def()] }))),
        "tools/call" => Some(handle_call(params, id)),
        "ping" => Some(result(id, json!({}))),
        _ => {
            // Unknown method. If it's a notification (no id), stay silent;
            // otherwise report method-not-found.
            if id.is_none() {
                None
            } else {
                Some(error(id, -32601, "method not found"))
            }
        }
    }
}

fn tool_def() -> Value {
    json!({
        "name": TOOL_NAME,
        "description": "Load a MeeCode Task's description and captured sources as context. \
Call this when a Task is attached to the session so its content enters the conversation. \
Pass the task_id given in the attach instruction.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "task_id": {
                    "type": "string",
                    "description": "The MeeCode task id to load (e.g. task-1a2b-0)."
                }
            },
            "required": ["task_id"]
        }
    })
}

fn handle_call(params: Option<&Value>, id: Option<Value>) -> Value {
    let name = params
        .and_then(|p| p.get("name"))
        .and_then(|v| v.as_str())
        .unwrap_or("");
    if name != TOOL_NAME {
        return error(id, -32602, &format!("unknown tool: {name}"));
    }
    let task_id = params
        .and_then(|p| p.get("arguments"))
        .and_then(|a| a.get("task_id"))
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();
    if task_id.is_empty() {
        return tool_error(id, "load_task_context requires a non-empty task_id");
    }
    let root = tasks::default_tasks_root();
    let task = match tasks::read_task(&root, &task_id) {
        Ok(t) => t,
        Err(e) => return tool_error(id, &format!("task not found: {e}")),
    };
    let sources = tasks::list_sources(&root, &task_id).unwrap_or_default();
    let markdown = tasks::build_context_markdown(&task, &sources)
        .unwrap_or_else(|| format!("# {}\n\n(이 Task에는 아직 주입할 내용이 없습니다.)", task.name));
    result(
        id,
        json!({
            "content": [{ "type": "text", "text": markdown }],
            "isError": false,
        }),
    )
}

fn result(id: Option<Value>, value: Value) -> Value {
    json!({ "jsonrpc": "2.0", "id": id.unwrap_or(Value::Null), "result": value })
}

fn error(id: Option<Value>, code: i64, message: &str) -> Value {
    json!({
        "jsonrpc": "2.0",
        "id": id.unwrap_or(Value::Null),
        "error": { "code": code, "message": message },
    })
}

/// Tool-level failures are reported as a successful JSON-RPC result with
/// `isError: true` so the model sees them as a tool result rather than a
/// transport error (per the MCP spec).
fn tool_error(id: Option<Value>, message: &str) -> Value {
    result(
        id,
        json!({
            "content": [{ "type": "text", "text": message }],
            "isError": true,
        }),
    )
}
