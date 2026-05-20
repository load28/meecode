pub mod claude_discovery;
pub mod claude_process;
pub mod commands;
pub mod config;
pub mod history;
pub mod organize;
pub mod pins;

use commands::AppState;
use tauri::{Emitter, Manager};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(AppState::new())
        .setup(|app| {
            let handle = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                let needs_discover = {
                    let state = handle.state::<AppState>();
                    let cfg = match state.config.lock() {
                        Ok(c) => c,
                        Err(_) => return,
                    };
                    cfg.claude_path
                        .as_deref()
                        .map(|s| s.trim().is_empty())
                        .unwrap_or(true)
                };
                if !needs_discover {
                    return;
                }
                let Some(found) = claude_discovery::discover_claude().await else {
                    return;
                };
                {
                    let state = handle.state::<AppState>();
                    let cfg_clone = match state.config.lock() {
                        Ok(mut guard) => {
                            guard.claude_path = Some(found.clone());
                            guard.clone()
                        }
                        Err(_) => return,
                    };
                    let _ = cfg_clone.save();
                }
                let _ = handle.emit(
                    "claude_path:changed",
                    serde_json::json!({ "path": found }),
                );
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::start_session,
            commands::send_user_message,
            commands::send_tool_response,
            commands::interrupt_session,
            commands::set_permission_mode,
            commands::set_model,
            commands::set_thinking_level,
            commands::search_files,
            commands::list_recent_projects,
            commands::list_project_sessions,
            commands::switch_session,
            commands::close_tab,
            commands::read_file_text,
            commands::open_external,
            commands::get_config,
            commands::set_config,
            commands::discover_claude_path,
            commands::validate_claude_path,
            commands::set_claude_path,
            commands::get_claude_status,
            commands::pin_snippet,
            commands::list_project_pins,
            commands::delete_project_pin,
            commands::list_project_wiki,
            commands::read_project_wiki,
            commands::apply_wiki_diff,
            commands::delete_project_wiki,
            commands::organize_notes,
            commands::cancel_organize,
        ])
        .run(tauri::generate_context!())
        .expect("error running meecode");
}
