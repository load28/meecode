//! ndjson stdio transport for the sidecar — the Rust half of the contract the
//! Electron main broker speaks (`{t:'req'|'res'|'evt', ...}`).
//!
//! Requests are dispatched concurrently on a tokio runtime (mirroring Tauri's
//! per-command async tasks): a slow command — a 3s claude `--version` probe, a
//! streaming session — can't block file reads behind it.

use serde::Deserialize;
use serde_json::Value;
use std::future::Future;
use std::io::{self, BufRead, Write};
use std::sync::{Arc, Mutex};
use std::time::Duration;

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
/// any thread.
pub fn emit_event(channel: &str, payload: Value) {
    write_line(&serde_json::json!({ "t": "evt", "channel": channel, "payload": payload }));
}

/// Read requests line-by-line from stdin and reply with the dispatcher's result.
/// Each request runs as its own task. Blocks until stdin closes (host exited).
/// On error the dispatcher returns a `Value` (a JSON string for ordinary errors,
/// a structured object for commands that reject with typed errors).
pub fn run<F, Fut>(dispatch: F)
where
    F: Fn(String, Value) -> Fut + Send + Sync + 'static,
    Fut: Future<Output = Result<Value, Value>> + Send + 'static,
{
    let rt = match tokio::runtime::Builder::new_multi_thread().enable_all().build() {
        Ok(rt) => rt,
        Err(_) => return,
    };
    let dispatch = Arc::new(dispatch);
    {
        let stdin = io::stdin();
        for line in stdin.lock().lines() {
            let Ok(line) = line else { break };
            let line = line.trim().to_string();
            if line.is_empty() {
                continue;
            }
            let req: Req = match serde_json::from_str(&line) {
                Ok(r) => r,
                Err(_) => continue,
            };
            let dispatch = dispatch.clone();
            rt.spawn(async move {
                let res = match dispatch(req.cmd, req.args).await {
                    Ok(result) => {
                        serde_json::json!({ "t": "res", "id": req.id, "ok": true, "result": result })
                    }
                    Err(error) => {
                        serde_json::json!({ "t": "res", "id": req.id, "ok": false, "error": error })
                    }
                };
                write_line(&res);
            });
        }
    }
    // stdin closed (host exiting / EOF). Give in-flight requests a brief grace
    // period to finish and flush before the runtime is torn down.
    rt.shutdown_timeout(Duration::from_secs(2));
}
