pub mod claude_process;
pub mod commands;
pub mod config;
pub mod history;

use commands::AppState;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(AppState::new())
        .invoke_handler(tauri::generate_handler![
            commands::start_session,
            commands::send_user_message,
            commands::send_tool_response,
            commands::get_config,
            commands::set_config,
        ])
        .run(tauri::generate_context!())
        .expect("error running meecode");
}
