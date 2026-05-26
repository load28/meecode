//! Out-of-process language servers (LSP), bridged to the webview.
//!
//! A language plugin can declare a server program; the frontend asks us to
//! spawn it, then exchanges raw JSON-RPC messages. We own the `Content-Length`
//! framing: stdout frames are parsed and each JSON payload is emitted to the
//! frontend (`lsp:message`), and `lsp_send` re-frames outgoing payloads onto
//! the child's stdin. This keeps the JS side dealing in plain messages.

use std::collections::HashMap;
use std::io::{BufRead, BufReader, Read, Write};
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::{Arc, Mutex};

use serde::Deserialize;
use tauri::{AppHandle, Emitter, State};

#[derive(Default)]
pub struct LspState {
    servers: Mutex<HashMap<String, ServerHandle>>,
}

struct ServerHandle {
    child: Child,
    stdin: Arc<Mutex<ChildStdin>>,
}

#[derive(serde::Serialize, Clone)]
struct LspMessageEvent {
    id: String,
    message: String,
}

#[derive(Deserialize)]
pub struct LspStartArgs {
    pub id: String,
    pub command: String,
    #[serde(default)]
    pub args: Vec<String>,
}

#[tauri::command]
pub fn lsp_start(
    app: AppHandle,
    state: State<LspState>,
    args: LspStartArgs,
) -> Result<(), String> {
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

    // Drain stderr so a chatty server can't fill the pipe and deadlock; surface
    // lines for debugging.
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
    let app_clone = app.clone();
    std::thread::spawn(move || {
        let mut reader = BufReader::new(stdout);
        loop {
            let mut content_length: usize = 0;
            loop {
                let mut line = String::new();
                match reader.read_line(&mut line) {
                    Ok(0) | Err(_) => return, // EOF or read error
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
                return;
            }
            let message = String::from_utf8_lossy(&buf).into_owned();
            let _ = app_clone.emit(
                "lsp:message",
                LspMessageEvent {
                    id: id.clone(),
                    message,
                },
            );
        }
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

#[tauri::command]
pub fn lsp_send(state: State<LspState>, args: LspSendArgs) -> Result<(), String> {
    let servers = state.servers.lock().map_err(|e| e.to_string())?;
    let handle = servers.get(&args.id).ok_or("lsp: server not running")?;
    let mut stdin = handle.stdin.lock().map_err(|e| e.to_string())?;
    let header = format!(
        "Content-Length: {}\r\n\r\n",
        args.message.as_bytes().len()
    );
    stdin
        .write_all(header.as_bytes())
        .map_err(|e| e.to_string())?;
    stdin
        .write_all(args.message.as_bytes())
        .map_err(|e| e.to_string())?;
    stdin.flush().map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn lsp_stop(state: State<LspState>, id: String) -> Result<(), String> {
    let mut servers = state.servers.lock().map_err(|e| e.to_string())?;
    if let Some(mut handle) = servers.remove(&id) {
        let _ = handle.child.kill();
    }
    Ok(())
}
