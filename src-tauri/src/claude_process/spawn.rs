use crate::claude_process::protocol::StdinMessage;
use crate::claude_process::stdin_writer::write_line;
use crate::claude_process::stdout_parser::{parse_reader, DomainEvent};
use std::process::Stdio;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::process::{Child, Command};
use tokio::sync::mpsc;

static NEXT_PROCESS_ID: AtomicU64 = AtomicU64::new(1);

pub struct ProcessHandle {
    pub child: Child,
    pub stdin_tx: mpsc::Sender<StdinMessage>,
    /// Unique generation counter. on_exit callbacks compare against this to
    /// avoid clobbering a *newer* process that replaced this one before the
    /// callback fired.
    pub id: u64,
}

impl ProcessHandle {
    pub fn kill(&mut self) {
        let _ = self.child.start_kill();
    }
}

pub async fn spawn_claude(
    claude_bin: &str,
    project_path: &str,
    resume_session_id: Option<&str>,
    on_event: impl Fn(DomainEvent) + Send + Sync + 'static,
    on_stderr: impl Fn(String) + Send + Sync + 'static,
    on_exit: impl FnOnce(u64) + Send + 'static,
) -> Result<ProcessHandle, String> {
    let id = NEXT_PROCESS_ID.fetch_add(1, Ordering::Relaxed);
    let mut cmd = Command::new(claude_bin);
    cmd.current_dir(project_path);
    cmd.arg("--output-format").arg("stream-json");
    cmd.arg("--verbose");
    cmd.arg("--input-format").arg("stream-json");
    cmd.arg("--permission-prompt-tool").arg("stdio");
    // --include-partial-messages: receive `stream_event` lines carrying
    // Anthropic API SSE deltas (content_block_delta with thinking_delta /
    // text_delta / input_json_delta). Without it the UI can only show
    // assistant content after each block is fully complete, so live
    // thinking is invisible.
    cmd.arg("--include-partial-messages");
    // --include-hook-events: surfaces `system:hook_*` so we can label
    // hook activity in the UI. We already parse these, so opting in is
    // purely additive.
    cmd.arg("--include-hook-events");
    if let Some(id) = resume_session_id {
        cmd.arg("--resume").arg(id);
    }
    cmd.stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    let mut child = cmd.spawn().map_err(|e| format!("claude spawn failed: {e}"))?;
    let stdout = child.stdout.take().ok_or("no stdout pipe")?;
    let stderr = child.stderr.take().ok_or("no stderr pipe")?;
    let stdin = child.stdin.take().ok_or("no stdin pipe")?;

    let on_event = Arc::new(on_event);
    let on_stderr = Arc::new(on_stderr);

    {
        let on_event = on_event.clone();
        // stdout closing == claude exited. Run the user-provided cleanup
        // callback after the parse loop finishes so the frontend can clear
        // the in-flight indicator instead of spinning forever.
        tokio::spawn(async move {
            parse_reader(stdout, move |ev| on_event(ev)).await;
            on_exit(id);
        });
    }

    {
        let on_stderr = on_stderr.clone();
        tokio::spawn(async move {
            let mut reader = BufReader::new(stderr).lines();
            while let Ok(Some(line)) = reader.next_line().await {
                on_stderr(line);
            }
        });
    }

    let (tx, mut rx) = mpsc::channel::<StdinMessage>(32);
    tokio::spawn(async move {
        let mut stdin = stdin;
        while let Some(msg) = rx.recv().await {
            if write_line(&mut stdin, &msg).await.is_err() {
                break;
            }
        }
    });

    Ok(ProcessHandle {
        child,
        stdin_tx: tx,
        id,
    })
}
