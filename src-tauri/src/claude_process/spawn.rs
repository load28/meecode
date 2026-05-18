use crate::claude_process::protocol::StdinMessage;
use crate::claude_process::stdin_writer::write_line;
use crate::claude_process::stdout_parser::{parse_reader, DomainEvent};
use std::process::Stdio;
use std::sync::Arc;
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::process::{Child, Command};
use tokio::sync::mpsc;

pub struct ProcessHandle {
    pub child: Child,
    pub stdin_tx: mpsc::Sender<StdinMessage>,
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
) -> Result<ProcessHandle, String> {
    let mut cmd = Command::new(claude_bin);
    cmd.current_dir(project_path);
    cmd.arg("--output-format").arg("stream-json");
    cmd.arg("--verbose");
    cmd.arg("--input-format").arg("stream-json");
    cmd.arg("--permission-prompt-tool").arg("stdio");
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
        tokio::spawn(async move {
            parse_reader(stdout, move |ev| on_event(ev)).await;
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
    })
}
