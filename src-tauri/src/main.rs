#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    // Re-exec entry point: when launched as `meecode mcp-stdio` (by the
    // Claude CLI via --mcp-config), act as a stdio MCP server instead of
    // booting the Tauri GUI. Must run before any windowing setup.
    if std::env::args().nth(1).as_deref() == Some("mcp-stdio") {
        meecode_lib::mcp_server::run_stdio();
        return;
    }
    meecode_lib::run();
}
