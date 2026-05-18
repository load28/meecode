mod commands;
mod config;
mod pty_manager;

use commands::AppState;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(AppState::new())
        .invoke_handler(tauri::generate_handler![
            commands::start_session,
            commands::write_input,
            commands::get_config,
            commands::set_config,
            commands::resize_pty,
        ])
        .run(tauri::generate_context!())
        .expect("error running meecode");
}
