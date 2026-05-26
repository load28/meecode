//! Out-of-process language servers (LSP), ported from the Tauri lib (tauri-free).
//!
//! We own the `Content-Length` framing: stdout frames are parsed and each JSON
//! payload is emitted to the host as `lsp:message`; `lsp_send` re-frames
//! outgoing payloads onto the child's stdin. `lsp:exit` fires when a server's
//! stdout closes.

use std::collections::HashMap;
use std::io::{BufRead, BufReader, Read, Write};
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::{Arc, Mutex};

use serde::Deserialize;
use serde_json::json;

use crate::bridge::emit_event;
use crate::state::lsp;

#[derive(Default)]
pub struct LspState {
    servers: Mutex<HashMap<String, ServerHandle>>,
}

struct ServerHandle {
    child: Child,
    stdin: Arc<Mutex<ChildStdin>>,
}

#[derive(Deserialize)]
pub struct LspStartArgs {
    pub id: String,
    pub command: String,
    #[serde(default)]
    pub args: Vec<String>,
}

pub fn lsp_start(args: LspStartArgs) -> Result<(), String> {
    let state = lsp();
    {
        let servers = state.servers.lock().map_err(|e| e.to_string())?;
        if servers.contains_key(&args.id) {
            return Ok(()); // already running
        }
    }

    let mut child = Command::new(&args.command)
        .args(&args.args)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("spawn lsp '{}': {e}", args.command))?;

    let stdout = child.stdout.take().ok_or("lsp: no stdout")?;
    let stdin = child.stdin.take().ok_or("lsp: no stdin")?;

    // Drain stderr so a chatty server can't fill the pipe and deadlock.
    if let Some(stderr) = child.stderr.take() {
        let id = args.id.clone();
        std::thread::spawn(move || {
            let reader = BufReader::new(stderr);
            for line in reader.lines().map_while(Result::ok) {
                eprintln!("[lsp:{id}] {line}");
            }
        });
    }

    // Reader thread: parse Content-Length frames and emit each JSON payload.
    let id = args.id.clone();
    std::thread::spawn(move || {
        let mut reader = BufReader::new(stdout);
        'read: loop {
            let mut content_length: usize = 0;
            loop {
                let mut line = String::new();
                match reader.read_line(&mut line) {
                    Ok(0) | Err(_) => break 'read, // EOF or read error
                    Ok(_) => {}
                }
                let trimmed = line.trim_end();
                if trimmed.is_empty() {
                    break; // blank line terminates headers
                }
                if let Some(v) = trimmed.strip_prefix("Content-Length:") {
                    content_length = v.trim().parse().unwrap_or(0);
                }
            }
            if content_length == 0 {
                continue;
            }
            let mut buf = vec![0u8; content_length];
            if reader.read_exact(&mut buf).is_err() {
                break 'read;
            }
            let message = String::from_utf8_lossy(&buf).into_owned();
            // Broadcast; the frontend reader filters by server id.
            emit_event("lsp:message", json!({ "id": id, "message": message }));
        }
        // stdout closed — the server exited. Drop the dead handle so a future
        // lsp_start can respawn, and notify the frontend to tear down.
        if let Ok(mut servers) = lsp().servers.lock() {
            servers.remove(&id);
        }
        emit_event("lsp:exit", json!({ "id": id }));
    });

    let mut servers = state.servers.lock().map_err(|e| e.to_string())?;
    servers.insert(
        args.id,
        ServerHandle {
            child,
            stdin: Arc::new(Mutex::new(stdin)),
        },
    );
    Ok(())
}

#[derive(Deserialize)]
pub struct LspSendArgs {
    pub id: String,
    pub message: String,
}

pub fn lsp_send(args: LspSendArgs) -> Result<(), String> {
    let servers = lsp().servers.lock().map_err(|e| e.to_string())?;
    let handle = servers.get(&args.id).ok_or("lsp: server not running")?;
    let mut stdin = handle.stdin.lock().map_err(|e| e.to_string())?;
    let header = format!("Content-Length: {}\r\n\r\n", args.message.as_bytes().len());
    stdin
        .write_all(header.as_bytes())
        .map_err(|e| e.to_string())?;
    stdin
        .write_all(args.message.as_bytes())
        .map_err(|e| e.to_string())?;
    stdin.flush().map_err(|e| e.to_string())?;
    Ok(())
}

pub fn lsp_stop(id: String) -> Result<(), String> {
    let mut servers = lsp().servers.lock().map_err(|e| e.to_string())?;
    if let Some(mut handle) = servers.remove(&id) {
        let _ = handle.child.kill();
        let _ = handle.child.wait(); // reap so it doesn't linger as a zombie
    }
    Ok(())
}
