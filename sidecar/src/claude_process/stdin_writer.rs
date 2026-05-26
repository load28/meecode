use crate::claude_process::protocol::StdinMessage;
use tokio::io::{AsyncWrite, AsyncWriteExt};

pub fn serialize_to_line(msg: &StdinMessage) -> String {
    let mut s = serde_json::to_string(msg).expect("serialize StdinMessage");
    s.push('\n');
    s
}

pub async fn write_line<W: AsyncWrite + Unpin>(
    writer: &mut W,
    msg: &StdinMessage,
) -> std::io::Result<()> {
    let line = serialize_to_line(msg);
    writer.write_all(line.as_bytes()).await?;
    writer.flush().await
}
