mod bridge;
mod config;
mod file_watch;
mod files;
mod history;
mod lsp;
mod open_files;
mod state;
mod tasks;

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
        "list_dir" => {
            #[derive(Deserialize)]
            struct ListDirArgs {
                path: String,
                root: Option<String>,
                refresh: Option<bool>,
            }
            let a: ListDirArgs = from_value(args).map_err(de)?;
            ok(file_watch::list_dir(a.path, a.root, a.refresh)?)
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

        // ── config ───────────────────────────────────────────────────────────
        "get_config" => ok(state::get_config()?),
        "set_config" => {
            #[derive(Deserialize)]
            struct ConfigArg {
                config: config::Config,
            }
            let a: ConfigArg = from_value(args).map_err(de)?;
            ok(state::set_config(a.config)?)
        }

        // ── lsp ──────────────────────────────────────────────────────────────
        "lsp_start" => {
            let a: Wrapped<lsp::LspStartArgs> = from_value(args).map_err(de)?;
            ok(lsp::lsp_start(a.args)?)
        }
        "lsp_send" => {
            let a: Wrapped<lsp::LspSendArgs> = from_value(args).map_err(de)?;
            ok(lsp::lsp_send(a.args)?)
        }
        "lsp_stop" => {
            #[derive(Deserialize)]
            struct IdArg {
                id: String,
            }
            let a: IdArg = from_value(args).map_err(de)?;
            ok(lsp::lsp_stop(a.id)?)
        }

        // ── open-files watcher ─────────────────────────────────────────────────
        "set_watched_files" => {
            let a: Wrapped<open_files::SetWatchedFilesArgs> = from_value(args).map_err(de)?;
            ok(open_files::set_watched_files(a.args)?)
        }

        // ── project tree watcher ───────────────────────────────────────────────
        "watch_project" => {
            #[derive(Deserialize)]
            struct RootArg {
                root: String,
            }
            let a: RootArg = from_value(args).map_err(de)?;
            ok(file_watch::watch_project(a.root)?)
        }

        // ── history (recent projects / sessions) ───────────────────────────────
        "list_recent_projects" => ok(history::list::list_projects()?),
        "list_project_sessions" => {
            let a: PathArg = from_value(args).map_err(de)?;
            ok(history::list::list_sessions(&a.path)?)
        }

        // ── tasks (CRUD + sources + wiki) ──────────────────────────────────────
        "list_tasks" => ok(tasks::list_tasks(&tasks::default_tasks_root())?),
        "create_task" => {
            #[derive(Deserialize)]
            struct A {
                name: String,
                #[serde(default)]
                description: Option<String>,
            }
            let a: Wrapped<A> = from_value(args).map_err(de)?;
            ok(tasks::create_task(
                &tasks::default_tasks_root(),
                a.args.name,
                a.args.description.unwrap_or_default(),
            )?)
        }
        "get_task" => {
            #[derive(Deserialize)]
            struct A {
                task_id: String,
            }
            let a: A = from_value(args).map_err(de)?;
            ok(tasks::read_task(&tasks::default_tasks_root(), &a.task_id)?)
        }
        "update_task" => {
            #[derive(Deserialize)]
            struct A {
                task_id: String,
                #[serde(default)]
                name: Option<String>,
                #[serde(default)]
                description: Option<String>,
            }
            let a: Wrapped<A> = from_value(args).map_err(de)?;
            ok(tasks::update_task(
                &tasks::default_tasks_root(),
                &a.args.task_id,
                a.args.name,
                a.args.description,
            )?)
        }
        "delete_task" => {
            #[derive(Deserialize)]
            struct A {
                task_id: String,
            }
            let a: A = from_value(args).map_err(de)?;
            ok(tasks::delete_task(&tasks::default_tasks_root(), &a.task_id)?)
        }
        "list_task_sources" => {
            #[derive(Deserialize)]
            struct A {
                task_id: String,
            }
            let a: A = from_value(args).map_err(de)?;
            ok(tasks::list_sources(&tasks::default_tasks_root(), &a.task_id)?)
        }
        "create_source" => {
            #[derive(Deserialize)]
            struct A {
                task_id: String,
                kind: String,
                #[serde(default)]
                title: String,
                content: String,
                #[serde(default)]
                session_id: Option<String>,
                #[serde(default)]
                qa_id: Option<String>,
                #[serde(default)]
                project_path: Option<String>,
            }
            let a: Wrapped<A> = from_value(args).map_err(de)?;
            let a = a.args;
            let origin = tasks::SourceOrigin {
                session_id: a.session_id,
                qa_id: a.qa_id,
                project_path: a.project_path,
            };
            ok(tasks::create_source(
                &tasks::default_tasks_root(),
                &a.task_id,
                a.kind,
                a.title,
                a.content,
                origin,
            )?)
        }
        "delete_source" => {
            #[derive(Deserialize)]
            struct A {
                task_id: String,
                source_id: String,
            }
            let a: Wrapped<A> = from_value(args).map_err(de)?;
            ok(tasks::delete_source(
                &tasks::default_tasks_root(),
                &a.args.task_id,
                &a.args.source_id,
            )?)
        }
        "list_task_wiki_files" => {
            #[derive(Deserialize)]
            struct A {
                task_id: String,
            }
            let a: A = from_value(args).map_err(de)?;
            ok(tasks::list_wiki_files(&tasks::default_tasks_root(), &a.task_id)?)
        }
        "read_task_wiki" => {
            #[derive(Deserialize)]
            struct A {
                task_id: String,
                name: String,
            }
            let a: Wrapped<A> = from_value(args).map_err(de)?;
            ok(tasks::read_wiki_file(
                &tasks::default_tasks_root(),
                &a.args.task_id,
                &a.args.name,
            )?)
        }
        "write_task_wiki" => {
            #[derive(Deserialize)]
            struct A {
                task_id: String,
                name: String,
                content: String,
            }
            let a: Wrapped<A> = from_value(args).map_err(de)?;
            ok(tasks::write_wiki_file(
                &tasks::default_tasks_root(),
                &a.args.task_id,
                &a.args.name,
                &a.args.content,
            )?)
        }
        "delete_task_wiki" => {
            #[derive(Deserialize)]
            struct A {
                task_id: String,
                name: String,
            }
            let a: Wrapped<A> = from_value(args).map_err(de)?;
            ok(tasks::delete_wiki_file(
                &tasks::default_tasks_root(),
                &a.args.task_id,
                &a.args.name,
            )?)
        }

        other => Err(format!("unimplemented cmd: {other}")),
    }
}

fn main() {
    bridge::run(dispatch);
}
