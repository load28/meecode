use portable_pty::{native_pty_system, CommandBuilder, MasterPty, PtySize};
use std::io::{Read, Write};
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Emitter};

pub struct PtyManager {
    writer: Arc<Mutex<Box<dyn Write + Send>>>,
    master: Arc<Mutex<Box<dyn MasterPty + Send>>>,
}

impl PtyManager {
    pub fn spawn(app: AppHandle, claude_cmd: &str, cwd: &str) -> Result<Self, String> {
        let pty_system = native_pty_system();
        let pty = pty_system
            .openpty(PtySize {
                rows: 24,
                cols: 80,
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
        let master = Arc::new(Mutex::new(pty.master));

        std::thread::spawn(move || {
            let mut buf = [0u8; 4096];
            loop {
                match reader.read(&mut buf) {
                    Ok(0) | Err(_) => break,
                    Ok(n) => {
                        let raw_str = String::from_utf8_lossy(&buf[..n]).to_string();
                        app.emit("pty:data", &raw_str).ok();
                    }
                }
            }
        });

        Ok(PtyManager { writer, master })
    }

    pub fn write_input(&self, text: &str) -> Result<(), String> {
        let mut w = self.writer.lock().map_err(|e| e.to_string())?;
        w.write_all(text.as_bytes()).map_err(|e| e.to_string())
    }

    pub fn resize(&self, rows: u16, cols: u16) -> Result<(), String> {
        self.master
            .lock()
            .map_err(|e| e.to_string())?
            .resize(PtySize { rows, cols, pixel_width: 0, pixel_height: 0 })
            .map_err(|e| e.to_string())
    }
}
