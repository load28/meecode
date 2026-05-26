//! ndjson stdio transport for the sidecar — the Rust half of the contract the
//! Electron main broker speaks (`{t:'req'|'res'|'evt', ...}`).

use serde::Deserialize;
use serde_json::Value;
use std::io::{self, BufRead, Write};
use std::sync::Mutex;

#[derive(Deserialize)]
struct Req {
    id: u64,
    cmd: String,
    #[serde(default)]
    args: Value,
}

// Serializes all stdout writes so response lines and async event lines never
// interleave at the byte level.
static OUT_LOCK: Mutex<()> = Mutex::new(());

fn write_line(value: &Value) {
    let line = value.to_string();
    let _guard = OUT_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let mut out = io::stdout().lock();
    let _ = out.write_all(line.as_bytes());
    let _ = out.write_all(b"\n");
    let _ = out.flush();
}

/// Emit a one-way event to the host (rust → main → renderer). Safe to call from
/// any thread. (Wired up as the emit-bearing commands are ported in later M2 steps.)
#[allow(dead_code)]
pub fn emit_event(channel: &str, payload: Value) {
    write_line(&serde_json::json!({ "t": "evt", "channel": channel, "payload": payload }));
}

/// Read requests line-by-line from stdin and reply with the dispatcher's result.
/// Blocks until stdin closes (the host process exited).
pub fn run(dispatch: impl Fn(&str, Value) -> Result<Value, String>) {
    let stdin = io::stdin();
    for line in stdin.lock().lines() {
        let Ok(line) = line else { break };
        let line = line.trim();
        if line.is_empty() {
            continue;
        }
        let req: Req = match serde_json::from_str(line) {
            Ok(r) => r,
            Err(_) => continue,
        };
        let res = match dispatch(&req.cmd, req.args) {
            Ok(result) => serde_json::json!({ "t": "res", "id": req.id, "ok": true, "result": result }),
            Err(error) => serde_json::json!({ "t": "res", "id": req.id, "ok": false, "error": error }),
        };
        write_line(&res);
    }
}
