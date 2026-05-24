pub mod bindings;
pub mod claude_discovery;
pub mod claude_process;
pub mod commands;
pub mod config;
pub mod history;
pub mod tasks;

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
            commands::list_dir,
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
            commands::list_tasks,
            commands::create_task,
            commands::get_task,
            commands::update_task,
            commands::delete_task,
            commands::list_task_sources,
            commands::create_source,
            commands::delete_source,
            commands::attach_task,
            commands::detach_task,
            commands::list_session_task_bindings,
            commands::list_task_wiki_files,
            commands::read_task_wiki,
            commands::write_task_wiki,
            commands::delete_task_wiki,
            commands::get_organize_preview,
            commands::start_task_organize,
            commands::cancel_task_organize,
        ])
        .run(tauri::generate_context!())
        .expect("error running meecode");
}
