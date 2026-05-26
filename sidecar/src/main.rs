mod bridge;
mod files;

use serde::Deserialize;
use serde_json::{from_value, to_value, Value};

fn de(e: serde_json::Error) -> String {
    format!("bad args: {e}")
}

fn ok<T: serde::Serialize>(v: T) -> Result<Value, String> {
    to_value(v).map_err(|e| e.to_string())
}

/// Maps a command name + its argument object (the second arg to the renderer's
/// `invoke`) to a result. Mirrors the Tauri command param-binding convention:
/// scalar params are top-level fields; a single struct param named `args` is
/// nested under `args`.
fn dispatch(cmd: &str, args: Value) -> Result<Value, String> {
    #[derive(Deserialize)]
    struct PathArg {
        path: String,
    }
    #[derive(Deserialize)]
    struct FromTo {
        from: String,
        to: String,
    }
    #[derive(Deserialize)]
    struct CreateEntryArgs {
        path: String,
        is_dir: bool,
    }
    #[derive(Deserialize)]
    struct Wrapped<T> {
        args: T,
    }

    match cmd {
        "ping" => ok(serde_json::json!({ "pong": true, "echo": args })),
        "read_file_text" => {
            let a: PathArg = from_value(args).map_err(de)?;
            ok(files::read_file_text(a.path)?)
        }
        "stat_file" => {
            let a: PathArg = from_value(args).map_err(de)?;
            ok(files::stat_file(a.path)?)
        }
        "write_file" => {
            let a: Wrapped<files::WriteFileArgs> = from_value(args).map_err(de)?;
            ok(files::write_file(a.args)?)
        }
        "search_files" => {
            let a: Wrapped<files::SearchFilesArgs> = from_value(args).map_err(de)?;
            ok(files::search_files(a.args)?)
        }
        // NOTE: list_dir's watcher-cache fast path arrives with the file-watch
        // port (later M2 step); for now it always reads from disk.
        "list_dir" => {
            let a: PathArg = from_value(args).map_err(de)?;
            ok(files::read_dir_entries(&a.path)?)
        }
        "create_entry" => {
            let a: CreateEntryArgs = from_value(args).map_err(de)?;
            ok(files::create_entry(a.path, a.is_dir)?)
        }
        "rename_entry" => {
            let a: FromTo = from_value(args).map_err(de)?;
            ok(files::rename_entry(a.from, a.to)?)
        }
        "delete_entry" => {
            let a: PathArg = from_value(args).map_err(de)?;
            ok(files::delete_entry(a.path)?)
        }
        "open_external" => {
            let a: PathArg = from_value(args).map_err(de)?;
            ok(files::open_external(a.path)?)
        }
        other => Err(format!("unimplemented cmd: {other}")),
    }
}

fn main() {
    bridge::run(dispatch);
}
