use portable_pty::{native_pty_system, CommandBuilder, PtySize};
use std::io::{Read, Write};
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Emitter};

pub fn strip_ansi(input: &[u8]) -> String {
    let stripped = strip_ansi_escapes::strip(input);
    String::from_utf8_lossy(&stripped)
        .replace('\r', "")
        .to_string()
}

pub struct PtyManager {
    writer: Arc<Mutex<Box<dyn Write + Send>>>,
    md_buffer: Arc<Mutex<String>>,
}

impl PtyManager {
    pub fn spawn(
        app: AppHandle,
        claude_cmd: &str,
        threshold: usize,
        cwd: &str,
    ) -> Result<Self, String> {
        let pty_system = native_pty_system();
        let pty = pty_system
            .openpty(PtySize {
                rows: 24,
                cols: 220,
                pixel_width: 0,
                pixel_height: 0,
            })
            .map_err(|e| e.to_string())?;

        let mut cmd = CommandBuilder::new(claude_cmd);
        cmd.cwd(cwd);
        pty.slave
            .spawn_command(cmd)
            .map_err(|e| e.to_string())?;

        let writer = Arc::new(Mutex::new(
            pty.master.take_writer().map_err(|e| e.to_string())?,
        ));
        let mut reader = pty.master.try_clone_reader().map_err(|e| e.to_string())?;
        let md_buffer: Arc<Mutex<String>> = Arc::new(Mutex::new(String::new()));
        let md_buffer_reader = md_buffer.clone();

        std::thread::spawn(move || {
            let mut buf = [0u8; 4096];
            loop {
                match reader.read(&mut buf) {
                    Ok(0) | Err(_) => break,
                    Ok(n) => {
                        let raw = &buf[..n];
                        let raw_str = String::from_utf8_lossy(raw).to_string();
                        app.emit("pty:data", &raw_str).ok();

                        let clean = strip_ansi(raw);
                        let mut buf_lock = md_buffer_reader.lock().unwrap();
                        buf_lock.push_str(&clean);

                        if buf_lock.len() >= threshold {
                            app.emit("md:update", buf_lock.clone()).ok();
                        }
                    }
                }
            }
        });

        Ok(PtyManager { writer, md_buffer })
    }

    pub fn write_input(&self, text: &str) -> Result<(), String> {
        *self.md_buffer.lock().map_err(|e| e.to_string())? = String::new();
        let mut w = self.writer.lock().map_err(|e| e.to_string())?;
        w.write_all(text.as_bytes()).map_err(|e| e.to_string())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_strip_ansi_color_codes() {
        assert_eq!(strip_ansi(b"\x1b[32mHello\x1b[0m"), "Hello");
    }

    #[test]
    fn test_strip_ansi_plain_text() {
        assert_eq!(strip_ansi(b"plain text"), "plain text");
    }

    #[test]
    fn test_strip_ansi_complex_sequence() {
        assert_eq!(strip_ansi(b"\x1b[1;31mError:\x1b[0m message"), "Error: message");
    }

    #[test]
    fn test_strip_ansi_removes_carriage_return() {
        assert_eq!(strip_ansi(b"line1\r\nline2"), "line1\nline2");
    }
}
