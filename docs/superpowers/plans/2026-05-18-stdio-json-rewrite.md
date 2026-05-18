# MeeCode stdio JSON Rewrite Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** PTY 기반 MeeCode 코어를 폐기하고 `claude --output-format stream-json --permission-prompt-tool stdio` 위에서 도구 승인·모드·메시지를 정공으로 처리하는 architecture로 재작성한다.

**Architecture:** Backend(Rust)가 stream-json protocol을 캡슐화하고 frontend로는 깔끔한 도메인 이벤트(`session:history`, `session:message`, `session:tool_request`, `session:mode_change`)만 emit. Frontend `useClaudeSession` 훅이 이벤트를 reduce해 `pairs`, `pendingTool`, `mode` 상태로 노출하고, 인라인 `ToolApprovalCard`로 승인 흐름을 처리.

**Tech Stack:** Rust(tokio process/IO), Tauri 2, serde_json, React 18 + TypeScript, Vitest, cargo test.

**Spec reference:** `docs/superpowers/specs/2026-05-18-stdio-json-rewrite-design.md`

---

## File Structure

**Create (Rust):**
- `src-tauri/src/claude_process/mod.rs`
- `src-tauri/src/claude_process/protocol.rs`
- `src-tauri/src/claude_process/stdout_parser.rs`
- `src-tauri/src/claude_process/stdin_writer.rs`
- `src-tauri/src/claude_process/spawn.rs`
- `src-tauri/src/history/mod.rs`
- `src-tauri/src/history/load_recent.rs`
- `src-tauri/tests/fixtures/stream-json/basic-turn.jsonl`
- `src-tauri/tests/fixtures/stream-json/tool-permission.jsonl`
- `src-tauri/tests/fixtures/stream-json/mode-change.jsonl`

**Modify (Rust):**
- `src-tauri/Cargo.toml` — add `tokio`, remove `portable-pty`/`strip-ansi-escapes`/`notify`
- `src-tauri/src/lib.rs` — rewire module mounts and command handlers
- `src-tauri/src/commands.rs` — full rewrite (4 new commands)
- `src-tauri/src/config.rs` — keep, no functional change

**Delete (Rust):**
- `src-tauri/src/pty_manager.rs`
- `src-tauri/src/session_watcher.rs` (jsonl 파서만 `history/load_recent.rs`로 이전 후 삭제)

**Create (Frontend):**
- `src/hooks/useClaudeSession.ts`
- `src/hooks/useClaudeSession.test.ts`
- `src/components/ToolApprovalCard/index.tsx`
- `src/components/ToolApprovalCard/ToolApprovalCard.css`
- `src/components/ToolApprovalCard/ToolApprovalCard.test.tsx`

**Modify (Frontend):**
- `src/types.ts` — add `ToolRequest`, `Mode` types
- `src/components/ChatComposer/index.tsx` — rewrite (도메인 명령 invoke)
- `src/components/ChatComposer/ChatComposer.test.tsx` — rewrite
- `src/components/ChatStream/index.tsx` — accept `pendingTool` prop, render inline card
- `src/components/ChatStream/ChatStream.test.tsx` — extend
- `src/App.tsx` — swap `usePtyStream` for `useClaudeSession`, wire props

**Delete (Frontend):**
- `src/hooks/usePtyStream.ts`
- `src/hooks/usePtyStream.test.ts`

---

## Task 1: Capture stream-json fixtures

**Files:**
- Create: `src-tauri/tests/fixtures/stream-json/basic-turn.jsonl`
- Create: `src-tauri/tests/fixtures/stream-json/tool-permission.jsonl`
- Create: `src-tauri/tests/fixtures/stream-json/mode-change.jsonl`
- Create: `src-tauri/tests/fixtures/stream-json/NOTES.md`

This task is research + fixture generation. No production code yet, but every subsequent task depends on these fixtures.

- [ ] **Step 1: Create fixtures directory**

```bash
mkdir -p src-tauri/tests/fixtures/stream-json
```

- [ ] **Step 2: Generate a basic turn fixture**

Pick a small project path (e.g., a throwaway temp dir with one file). Then run:

```bash
mkdir -p /tmp/meecode-fixture && cd /tmp/meecode-fixture && echo "hello" > note.txt
claude --output-format stream-json --input-format stream-json --permission-prompt-tool stdio --print "Read note.txt and say what it contains" > /tmp/basic-turn.jsonl 2>&1
```

Inspect `/tmp/basic-turn.jsonl`. Copy to `src-tauri/tests/fixtures/stream-json/basic-turn.jsonl`. Each line should be a JSON object. Note the exact `"type"` discriminator values present.

- [ ] **Step 3: Generate a tool-permission fixture**

```bash
claude --output-format stream-json --input-format stream-json --permission-prompt-tool stdio --print "Append 'world' to /tmp/meecode-fixture/note.txt" > /tmp/tool-permission.jsonl 2>&1
```

This should trigger a permission request because Edit/Write tools are being asked for. Capture the `tool_permission_request` line and any `tool_permission_response` echo. Copy to `src-tauri/tests/fixtures/stream-json/tool-permission.jsonl`.

- [ ] **Step 4: Generate a mode-change fixture**

```bash
echo '{"type":"user","content":"Switch to plan mode and propose a plan"}' | claude --output-format stream-json --input-format stream-json > /tmp/mode-change.jsonl 2>&1
```

Or, if mode change is only achievable via a control keystroke / specific JSON command, document what `claude --help` shows about `--permission-mode` and capture whatever stream messages reflect mode changes. Copy to `src-tauri/tests/fixtures/stream-json/mode-change.jsonl`. If mode change does not appear as a stream message, note this clearly in `NOTES.md` — the implementation will use a fallback.

- [ ] **Step 5: Write `NOTES.md`**

Create `src-tauri/tests/fixtures/stream-json/NOTES.md` documenting:
- The exact `"type"` discriminator values observed (e.g., `system`, `user`, `assistant`, `result`, etc.)
- The actual JSON shape of `tool_permission_request` (request_id field name, tool_name field name, input structure)
- Whether mode changes appear as stream events; if so, the message shape; if not, what fallback is needed
- The actual stdin message shapes (probably echoed in stdout) for user messages and tool responses
- The `claude` CLI version used (`claude --version`)

This document is ground truth for all subsequent tasks. **If any of these differ from what Section 7 of the spec assumed, note the difference here — the implementation will follow the captured reality, not the spec's assumption.**

- [ ] **Step 6: Commit fixtures**

```bash
git add src-tauri/tests/fixtures/
git commit -m "$(cat <<'EOF'
test(fixtures): capture stream-json protocol samples

claude --output-format stream-json 출력을 캡쳐해 protocol 테스트의 ground truth fixture와 NOTES를 추가한다.
EOF
)"
```

---

## Task 2: Replace Rust dependencies

**Files:**
- Modify: `src-tauri/Cargo.toml`

- [ ] **Step 1: Edit Cargo.toml**

Replace `[dependencies]` block with:

```toml
[dependencies]
tauri = { version = "2", features = [] }
tauri-plugin-dialog = "2"
serde = { version = "1", features = ["derive"] }
serde_json = "1"
dirs = "5"
tokio = { version = "1", features = ["macros", "rt-multi-thread", "process", "io-util", "sync"] }

[dev-dependencies]
tempfile = "3"
tokio = { version = "1", features = ["macros", "rt-multi-thread", "process", "io-util", "sync", "test-util"] }
```

(Removed `portable-pty`, `strip-ansi-escapes`, `notify`. Added `tokio`.)

- [ ] **Step 2: Verify Cargo resolves**

```bash
cd src-tauri && cargo check
```
Expected: errors only about missing `pty_manager` / `session_watcher` modules referenced in `lib.rs`. Those will be cleaned in Task 8. tokio/serde must resolve cleanly.

- [ ] **Step 3: Commit**

```bash
git add src-tauri/Cargo.toml src-tauri/Cargo.lock
git commit -m "$(cat <<'EOF'
chore(deps): swap portable-pty stack for tokio

PTY를 폐기하고 stdio JSON protocol을 다룰 수 있도록 portable-pty/strip-ansi-escapes/notify를 제거하고 tokio를 추가한다.
EOF
)"
```

---

## Task 3: Rust `claude_process/protocol.rs` (TDD)

**Files:**
- Create: `src-tauri/src/claude_process/mod.rs`
- Create: `src-tauri/src/claude_process/protocol.rs`
- Create: `src-tauri/tests/protocol.rs`

This task encodes the **captured** stream-json schema as Rust types. The exact field names below assume the schema documented in `tests/fixtures/stream-json/NOTES.md`. **If NOTES.md shows different field names, use those instead** — the test must round-trip the actual fixture content.

- [ ] **Step 1: Create module skeleton**

Create `src-tauri/src/claude_process/mod.rs`:
```rust
pub mod protocol;
```

- [ ] **Step 2: Write the failing test**

Create `src-tauri/tests/protocol.rs`:
```rust
use meecode_lib::claude_process::protocol::{StreamMessage, StdinMessage, PermissionBehavior};
use std::fs;

#[test]
fn parses_basic_turn_fixture() {
    let raw = fs::read_to_string("tests/fixtures/stream-json/basic-turn.jsonl").unwrap();
    let mut variants = Vec::new();
    for line in raw.lines() {
        let line = line.trim();
        if line.is_empty() { continue; }
        let msg: StreamMessage = serde_json::from_str(line)
            .unwrap_or_else(|e| panic!("failed to parse line: {line}\nerror: {e}"));
        variants.push(std::mem::discriminant(&msg));
    }
    assert!(!variants.is_empty(), "fixture had no parseable messages");
}

#[test]
fn parses_tool_permission_request() {
    let raw = fs::read_to_string("tests/fixtures/stream-json/tool-permission.jsonl").unwrap();
    let req = raw.lines()
        .filter_map(|l| serde_json::from_str::<StreamMessage>(l).ok())
        .find(|m| matches!(m, StreamMessage::ToolPermissionRequest { .. }))
        .expect("no ToolPermissionRequest in fixture");
    if let StreamMessage::ToolPermissionRequest { request_id, tool_name, .. } = req {
        assert!(!request_id.is_empty());
        assert!(!tool_name.is_empty());
    }
}

#[test]
fn stdin_user_message_round_trip() {
    let msg = StdinMessage::User { content: "hello".into() };
    let json = serde_json::to_string(&msg).unwrap();
    assert!(json.contains("\"type\":\"user\""));
    assert!(json.contains("\"content\":\"hello\""));
}

#[test]
fn stdin_tool_response_round_trip() {
    let msg = StdinMessage::ToolPermissionResponse {
        request_id: "req-1".into(),
        behavior: PermissionBehavior::Allow,
    };
    let json = serde_json::to_string(&msg).unwrap();
    assert!(json.contains("\"request_id\":\"req-1\""));
    assert!(json.contains("\"behavior\":\"allow\""));
}
```

- [ ] **Step 3: Run test to verify it fails**

```bash
cd src-tauri && cargo test --test protocol
```
Expected: compile error — module/types not found.

- [ ] **Step 4: Implement protocol.rs**

Create `src-tauri/src/claude_process/protocol.rs`:
```rust
use serde::{Deserialize, Serialize};
use serde_json::Value;

/// Stream-JSON messages emitted by `claude --output-format stream-json`.
///
/// The exact variants are derived from real CLI output captured in
/// `tests/fixtures/stream-json/`. Adjust this enum if NOTES.md documents
/// additional variants observed in capture.
#[derive(Debug, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum StreamMessage {
    System { subtype: Option<String>, session_id: Option<String>, #[serde(flatten)] rest: Value },
    User { message: Value },
    Assistant { message: Value },
    Result { #[serde(flatten)] rest: Value },
    ToolPermissionRequest { request_id: String, tool_name: String, input: Value },
    ModeChange { mode: String },
    Error { message: String },
    #[serde(other)]
    Unknown,
}

#[derive(Debug, Serialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum StdinMessage {
    User { content: String },
    ToolPermissionResponse { request_id: String, behavior: PermissionBehavior },
    Control { action: String },
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum PermissionBehavior {
    Allow,
    Deny,
}
```

> **Tune to fixture:** If NOTES.md documents that `tool_permission_request` uses a different field name (e.g. `tool_use_id` instead of `request_id`), update both the protocol enum and any later task that references `request_id`. The same applies to mode-change shape. The fixture is the source of truth.

- [ ] **Step 5: Update `lib.rs` to expose the module**

Replace `src-tauri/src/lib.rs` with (we'll add full content in Task 8; for now just enable compilation):
```rust
pub mod claude_process;
pub mod config;
pub mod commands;

use commands::AppState;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(AppState::new())
        .invoke_handler(tauri::generate_handler![commands::get_config, commands::set_config])
        .run(tauri::generate_context!())
        .expect("error running meecode");
}
```

(Old PTY/session_watcher/start_session/write_input/resize_pty are removed. They will be replaced with new commands in Task 8.)

Also temporarily simplify `src-tauri/src/commands.rs` so it compiles:
```rust
use crate::config::Config;
use std::sync::Mutex;
use tauri::State;

pub struct AppState {
    pub config: Mutex<Config>,
}

impl AppState {
    pub fn new() -> Self {
        Self { config: Mutex::new(Config::load()) }
    }
}

#[tauri::command]
pub fn get_config(state: State<AppState>) -> Result<Config, String> {
    Ok(state.config.lock().map_err(|e| e.to_string())?.clone())
}

#[tauri::command]
pub fn set_config(config: Config, state: State<AppState>) -> Result<(), String> {
    config.save()?;
    *state.config.lock().map_err(|e| e.to_string())? = config;
    Ok(())
}
```

Delete `src-tauri/src/pty_manager.rs` and `src-tauri/src/session_watcher.rs`:
```bash
git rm src-tauri/src/pty_manager.rs src-tauri/src/session_watcher.rs
```

- [ ] **Step 6: Run test to verify it passes**

```bash
cd src-tauri && cargo test --test protocol
```
Expected: 4/4 PASS. If parses fail with "unknown variant", add the variant to `StreamMessage` based on the actual fixture line.

- [ ] **Step 7: Commit**

```bash
git add src-tauri/src/claude_process/ src-tauri/src/lib.rs src-tauri/src/commands.rs src-tauri/tests/protocol.rs
git rm src-tauri/src/pty_manager.rs src-tauri/src/session_watcher.rs 2>/dev/null || true
git commit -m "$(cat <<'EOF'
feat(rust): add stream-json protocol types

claude CLI의 stream-json 입출력 schema를 Rust 타입으로 정의하고 fixture 기반 round-trip 테스트를 추가한다. 기존 PTY/세션 watcher 모듈은 제거한다.
EOF
)"
```

---

## Task 4: Rust `claude_process/stdout_parser.rs` (TDD)

**Files:**
- Create: `src-tauri/src/claude_process/stdout_parser.rs`
- Create: `src-tauri/tests/stdout_parser.rs`

The parser reads line-delimited JSON from any `AsyncBufRead` and converts each line to a `DomainEvent`. Decoupling from the actual child process makes it unit-testable with fixture content.

- [ ] **Step 1: Write the failing test**

Create `src-tauri/tests/stdout_parser.rs`:
```rust
use meecode_lib::claude_process::stdout_parser::{parse_stream, DomainEvent};
use std::io::Cursor;

#[tokio::test]
async fn parses_fixture_to_domain_events() {
    let raw = std::fs::read_to_string("tests/fixtures/stream-json/tool-permission.jsonl").unwrap();
    let reader = Cursor::new(raw);
    let mut events = Vec::new();
    parse_stream(reader, |ev| events.push(ev)).await;
    assert!(
        events.iter().any(|e| matches!(e, DomainEvent::ToolRequest { .. })),
        "expected ToolRequest event; got {events:?}"
    );
}

#[tokio::test]
async fn ignores_unparseable_lines() {
    let input = "{\"type\":\"system\"}\nnot-json\n{\"type\":\"assistant\",\"message\":{}}\n";
    let mut events = Vec::new();
    parse_stream(Cursor::new(input), |ev| events.push(ev)).await;
    // System (ignored or mapped) + Assistant → at least Assistant maps to Message.
    let messages = events.iter().filter(|e| matches!(e, DomainEvent::Message { .. })).count();
    assert!(messages >= 1);
}

#[tokio::test]
async fn empty_input_emits_no_events() {
    let mut events = Vec::new();
    parse_stream(Cursor::new(""), |ev| events.push(ev)).await;
    assert!(events.is_empty());
}
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd src-tauri && cargo test --test stdout_parser
```
Expected: compile error — module not found.

- [ ] **Step 3: Implement stdout_parser.rs**

Create `src-tauri/src/claude_process/stdout_parser.rs`:
```rust
use crate::claude_process::protocol::StreamMessage;
use serde_json::Value;
use tokio::io::{AsyncBufRead, AsyncBufReadExt, BufReader};

#[derive(Debug)]
pub enum DomainEvent {
    History(Vec<Value>),
    Message { raw: Value },
    ToolRequest { request_id: String, tool_name: String, input: Value },
    ModeChange { mode: String },
    Error { message: String },
    SessionStart { session_id: String },
}

/// Reads line-delimited JSON from `reader`, parses each line as a
/// `StreamMessage`, and invokes `emit` with one `DomainEvent` per recognized line.
/// Unknown or unparseable lines are silently skipped.
pub async fn parse_stream<R, F>(reader: R, mut emit: F)
where
    R: AsyncBufRead + Unpin,
    F: FnMut(DomainEvent),
{
    let mut reader = BufReader::new(reader);
    let mut line = String::new();
    loop {
        line.clear();
        let read = reader.read_line(&mut line).await;
        match read {
            Ok(0) => break, // EOF
            Ok(_) => {
                let trimmed = line.trim();
                if trimmed.is_empty() { continue; }
                let Ok(msg) = serde_json::from_str::<StreamMessage>(trimmed) else { continue };
                match msg {
                    StreamMessage::ToolPermissionRequest { request_id, tool_name, input } => {
                        emit(DomainEvent::ToolRequest { request_id, tool_name, input });
                    }
                    StreamMessage::ModeChange { mode } => emit(DomainEvent::ModeChange { mode }),
                    StreamMessage::Error { message } => emit(DomainEvent::Error { message }),
                    StreamMessage::System { session_id: Some(id), .. } => {
                        emit(DomainEvent::SessionStart { session_id: id });
                    }
                    StreamMessage::User { message } | StreamMessage::Assistant { message } => {
                        emit(DomainEvent::Message { raw: message });
                    }
                    _ => {}
                }
            }
            Err(_) => break,
        }
    }
}
```

Add the module to `src-tauri/src/claude_process/mod.rs`:
```rust
pub mod protocol;
pub mod stdout_parser;
```

`tokio::io::AsyncBufRead` requires the `tokio` feature `io-util` already added in Task 2.

Make `parse_stream` callable from tests by adding a `Cursor` impl. `std::io::Cursor` implements `AsyncRead` via the `tokio-util` adapter, but `tokio::io::AsyncBufRead` is implemented by `tokio::io::BufReader<R>` where `R: AsyncRead`. For sync test input, wrap with `tokio::io::BufReader::new(tokio::io::AllowStdIo::new(Cursor::new(input)))`. Update the test imports accordingly:

```rust
use tokio::io::BufReader;
let reader = BufReader::new(tokio::io::AllowStdIo::new(Cursor::new(input)));
parse_stream(reader, |ev| events.push(ev)).await;
```

If `AllowStdIo` is not available in tokio (was moved to `tokio-util`), add `tokio-util = { version = "0.7", features = ["compat"] }` to `dev-dependencies` and use `tokio_util::io::ReaderStream` or `std_io.compat()`. Simpler alternative: write fixtures to a temp file and open with `tokio::fs::File`.

**Easier alternative implementation** — accept `&str` directly in `parse_stream`:
```rust
pub async fn parse_stream(input: &str, mut emit: impl FnMut(DomainEvent)) {
    for line in input.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty() { continue; }
        let Ok(msg) = serde_json::from_str::<StreamMessage>(trimmed) else { continue };
        // (same match block as above)
    }
}
```

Use this string-based signature in tests AND in Task 6's real spawn loop, where you can read child stdout line-by-line and pass each line via a different helper. Keep both: a streaming variant for production (`parse_lines<R: AsyncBufRead>(...)`) and a string variant for fixture tests (`parse_str(input: &str, emit: ...)`), sharing a private `parse_one(line: &str) -> Option<DomainEvent>` helper.

Final implementation:
```rust
use crate::claude_process::protocol::StreamMessage;
use serde_json::Value;
use tokio::io::{AsyncBufReadExt, BufReader, AsyncRead};

#[derive(Debug)]
pub enum DomainEvent {
    Message { raw: Value },
    ToolRequest { request_id: String, tool_name: String, input: Value },
    ModeChange { mode: String },
    Error { message: String },
    SessionStart { session_id: String },
}

fn parse_one(line: &str) -> Option<DomainEvent> {
    let trimmed = line.trim();
    if trimmed.is_empty() { return None; }
    let msg: StreamMessage = serde_json::from_str(trimmed).ok()?;
    Some(match msg {
        StreamMessage::ToolPermissionRequest { request_id, tool_name, input } =>
            DomainEvent::ToolRequest { request_id, tool_name, input },
        StreamMessage::ModeChange { mode } => DomainEvent::ModeChange { mode },
        StreamMessage::Error { message } => DomainEvent::Error { message },
        StreamMessage::System { session_id: Some(id), .. } => DomainEvent::SessionStart { session_id: id },
        StreamMessage::User { message } | StreamMessage::Assistant { message } => DomainEvent::Message { raw: message },
        _ => return None,
    })
}

pub async fn parse_stream(input: impl AsRef<str>, mut emit: impl FnMut(DomainEvent)) {
    for line in input.as_ref().lines() {
        if let Some(ev) = parse_one(line) { emit(ev); }
    }
}

pub async fn parse_reader<R: AsyncRead + Unpin>(reader: R, mut emit: impl FnMut(DomainEvent)) {
    let mut buf = BufReader::new(reader);
    let mut line = String::new();
    loop {
        line.clear();
        match buf.read_line(&mut line).await {
            Ok(0) => break,
            Ok(_) => if let Some(ev) = parse_one(&line) { emit(ev); },
            Err(_) => break,
        }
    }
}
```

Update test to call `parse_stream(raw, |ev| ...)` — signature matches.

- [ ] **Step 4: Run test to verify it passes**

```bash
cd src-tauri && cargo test --test stdout_parser
```
Expected: 3/3 PASS.

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/claude_process/ src-tauri/tests/stdout_parser.rs
git commit -m "$(cat <<'EOF'
feat(rust): add stdout parser turning stream-json into domain events

claude의 stream-json 라인을 DomainEvent로 변환하는 string·async-reader 두 진입점을 추가한다. 알 수 없는 라인은 조용히 무시한다.
EOF
)"
```

---

## Task 5: Rust `claude_process/stdin_writer.rs` (TDD)

**Files:**
- Create: `src-tauri/src/claude_process/stdin_writer.rs`
- Create: `src-tauri/tests/stdin_writer.rs`

- [ ] **Step 1: Write the failing test**

Create `src-tauri/tests/stdin_writer.rs`:
```rust
use meecode_lib::claude_process::stdin_writer::serialize_to_line;
use meecode_lib::claude_process::protocol::{StdinMessage, PermissionBehavior};

#[test]
fn user_message_ends_with_newline() {
    let line = serialize_to_line(&StdinMessage::User { content: "hi".into() });
    assert!(line.ends_with('\n'));
    assert!(line.contains("\"type\":\"user\""));
    assert!(line.contains("\"content\":\"hi\""));
}

#[test]
fn tool_response_serializes_request_id() {
    let line = serialize_to_line(&StdinMessage::ToolPermissionResponse {
        request_id: "req-9".into(),
        behavior: PermissionBehavior::Deny,
    });
    assert!(line.contains("\"request_id\":\"req-9\""));
    assert!(line.contains("\"behavior\":\"deny\""));
}

#[test]
fn control_action_serializes() {
    let line = serialize_to_line(&StdinMessage::Control { action: "cycle_mode".into() });
    assert!(line.contains("\"type\":\"control\""));
    assert!(line.contains("\"action\":\"cycle_mode\""));
}
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd src-tauri && cargo test --test stdin_writer
```
Expected: compile error.

- [ ] **Step 3: Implement stdin_writer.rs**

Create `src-tauri/src/claude_process/stdin_writer.rs`:
```rust
use crate::claude_process::protocol::StdinMessage;
use tokio::io::{AsyncWrite, AsyncWriteExt};

pub fn serialize_to_line(msg: &StdinMessage) -> String {
    let mut s = serde_json::to_string(msg).expect("serialize StdinMessage");
    s.push('\n');
    s
}

pub async fn write_line<W: AsyncWrite + Unpin>(writer: &mut W, msg: &StdinMessage) -> std::io::Result<()> {
    let line = serialize_to_line(msg);
    writer.write_all(line.as_bytes()).await?;
    writer.flush().await
}
```

Add to `src-tauri/src/claude_process/mod.rs`:
```rust
pub mod protocol;
pub mod stdout_parser;
pub mod stdin_writer;
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd src-tauri && cargo test --test stdin_writer
```
Expected: 3/3 PASS.

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/claude_process/ src-tauri/tests/stdin_writer.rs
git commit -m "$(cat <<'EOF'
feat(rust): add stdin writer serializing StdinMessage to JSON line

도메인 명령을 JSON 한 줄 + 개행으로 직렬화하고 자식 프로세스 stdin에 flush하는 헬퍼를 추가한다.
EOF
)"
```

---

## Task 6: Rust `claude_process/spawn.rs`

**Files:**
- Create: `src-tauri/src/claude_process/spawn.rs`

Spawning the child and wiring stdin/stdout tasks involves real IO; we test it via the integration test in Task 9 (end-to-end with the mocked AppState) or smoke test in Task 14. This task itself focuses on the structure.

- [ ] **Step 1: Implement spawn.rs**

Create `src-tauri/src/claude_process/spawn.rs`:
```rust
use crate::claude_process::protocol::StdinMessage;
use crate::claude_process::stdin_writer::write_line;
use crate::claude_process::stdout_parser::{parse_reader, DomainEvent};
use std::process::Stdio;
use tokio::process::{Child, Command};
use tokio::sync::mpsc;

pub struct ProcessHandle {
    pub child: Child,
    pub stdin_tx: mpsc::Sender<StdinMessage>,
}

impl ProcessHandle {
    pub fn kill(&mut self) {
        let _ = self.child.start_kill();
    }
}

pub async fn spawn_claude(
    claude_bin: &str,
    project_path: &str,
    resume_session_id: Option<&str>,
    on_event: impl Fn(DomainEvent) + Send + 'static + Clone,
) -> Result<ProcessHandle, String> {
    let mut cmd = Command::new(claude_bin);
    cmd.current_dir(project_path);
    cmd.arg("--output-format").arg("stream-json");
    cmd.arg("--input-format").arg("stream-json");
    cmd.arg("--permission-prompt-tool").arg("stdio");
    cmd.arg("--verbose");
    if let Some(id) = resume_session_id {
        cmd.arg("--resume").arg(id);
    }
    cmd.stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::piped());

    let mut child = cmd.spawn().map_err(|e| format!("claude spawn failed: {e}"))?;
    let stdout = child.stdout.take().ok_or("no stdout pipe")?;
    let stdin = child.stdin.take().ok_or("no stdin pipe")?;

    // stdout reader task
    let cb = on_event.clone();
    tokio::spawn(async move {
        parse_reader(stdout, move |ev| cb(ev)).await;
    });

    // stdin writer task
    let (tx, mut rx) = mpsc::channel::<StdinMessage>(32);
    tokio::spawn(async move {
        let mut stdin = stdin;
        while let Some(msg) = rx.recv().await {
            if write_line(&mut stdin, &msg).await.is_err() { break; }
        }
    });

    Ok(ProcessHandle { child, stdin_tx: tx })
}
```

Add to `mod.rs`:
```rust
pub mod protocol;
pub mod stdout_parser;
pub mod stdin_writer;
pub mod spawn;
```

- [ ] **Step 2: cargo check**

```bash
cd src-tauri && cargo check
```
Expected: clean compile (no test for this task — spawn is exercised end-to-end).

- [ ] **Step 3: Commit**

```bash
git add src-tauri/src/claude_process/
git commit -m "$(cat <<'EOF'
feat(rust): add child process spawn with stdout reader and stdin writer tasks

claude --output-format stream-json --permission-prompt-tool stdio를 자식 프로세스로 띄우고 stdout/stdin을 각각 tokio task로 분리해 운용한다.
EOF
)"
```

---

## Task 7: Rust `history/load_recent.rs`

**Files:**
- Create: `src-tauri/src/history/mod.rs`
- Create: `src-tauri/src/history/load_recent.rs`

The jsonl parser used in the old `session_watcher.rs` already converts user/assistant messages into `QaPair`. Port that function here (without the file-watcher half).

- [ ] **Step 1: Create module**

Create `src-tauri/src/history/mod.rs`:
```rust
pub mod load_recent;
```

- [ ] **Step 2: Implement load_recent.rs**

Create `src-tauri/src/history/load_recent.rs`. Copy the `AssistantSegment`, `QaPair`, `classify_user_content`, `summarize_tool_input`, `assistant_segments_from_content`, and `extract_qa_pairs` items from the deleted `session_watcher.rs` (they live in git history at commit `7319ada` or earlier). Then add:

```rust
use std::path::{Path, PathBuf};
use std::time::SystemTime;

pub fn projects_dir_for(project_path: &str) -> Result<PathBuf, String> {
    let home = dirs::home_dir().ok_or_else(|| "no home dir".to_string())?;
    let dash_path = project_path.replace('/', "-");
    Ok(home.join(".claude").join("projects").join(dash_path))
}

pub fn load_recent_pairs(project_path: &str) -> Result<Vec<QaPair>, String> {
    let dir = projects_dir_for(project_path)?;
    if !dir.exists() { return Ok(Vec::new()); }
    let entries = std::fs::read_dir(&dir).map_err(|e| e.to_string())?;
    let mut newest: Option<(PathBuf, SystemTime)> = None;
    for entry in entries.flatten() {
        let path = entry.path();
        if path.extension().and_then(|s| s.to_str()) != Some("jsonl") { continue; }
        let Ok(modified) = entry.metadata().and_then(|m| m.modified()) else { continue };
        match &newest {
            Some((_, t)) if *t >= modified => {}
            _ => newest = Some((path, modified)),
        }
    }
    Ok(newest.map(|(p, _)| extract_qa_pairs(&p)).unwrap_or_default())
}
```

The `QaPair` and `AssistantSegment` `serde::Serialize` derive must remain so the frontend can deserialize.

- [ ] **Step 3: Run existing-pattern tests on the ported code**

The original `session_watcher.rs` had ~10 unit tests for `extract_qa_pairs`. Copy them as inline `#[cfg(test)] mod tests` in `load_recent.rs`:
```bash
cd src-tauri && cargo test history
```
Expected: ~10 PASS (all the user/assistant/tool_result/plan/etc parsing cases).

- [ ] **Step 4: Wire into lib.rs**

Edit `src-tauri/src/lib.rs`:
```rust
pub mod claude_process;
pub mod config;
pub mod commands;
pub mod history;
```

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/history/ src-tauri/src/lib.rs
git commit -m "$(cat <<'EOF'
feat(rust): add history loader for most-recent project jsonl

기존 session_watcher의 jsonl 파서를 watcher 없이 history 모듈로 옮기고 가장 최근 jsonl만 읽어 QaPair 배열을 반환한다.
EOF
)"
```

---

## Task 8: Rust `commands.rs` rewrite

**Files:**
- Modify: `src-tauri/src/commands.rs`
- Modify: `src-tauri/src/lib.rs`

- [ ] **Step 1: Replace commands.rs**

Replace `src-tauri/src/commands.rs` content with:
```rust
use crate::claude_process::protocol::{StdinMessage, PermissionBehavior};
use crate::claude_process::spawn::{spawn_claude, ProcessHandle};
use crate::claude_process::stdout_parser::DomainEvent;
use crate::config::Config;
use crate::history::load_recent::{load_recent_pairs, QaPair};
use serde::Deserialize;
use serde_json::Value;
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, Manager, State};
use tokio::sync::mpsc::Sender;

pub struct AppState {
    pub process: Mutex<Option<ProcessHandle>>,
    pub session_id: Mutex<Option<String>>,
    pub config: Mutex<Config>,
}

impl AppState {
    pub fn new() -> Self {
        Self {
            process: Mutex::new(None),
            session_id: Mutex::new(None),
            config: Mutex::new(Config::load()),
        }
    }
}

fn dispatch_event(app: &AppHandle, ev: DomainEvent) {
    match ev {
        DomainEvent::Message { raw } => { let _ = app.emit("session:message", raw); }
        DomainEvent::ToolRequest { request_id, tool_name, input } => {
            let _ = app.emit("session:tool_request",
                serde_json::json!({ "request_id": request_id, "tool_name": tool_name, "input": input }));
        }
        DomainEvent::ModeChange { mode } => { let _ = app.emit("session:mode_change", serde_json::json!({ "mode": mode })); }
        DomainEvent::Error { message } => { let _ = app.emit("session:error", serde_json::json!({ "message": message })); }
        DomainEvent::SessionStart { session_id } => {
            if let Some(state) = app.try_state::<AppState>() {
                if let Ok(mut guard) = state.session_id.lock() {
                    *guard = Some(session_id);
                }
            }
        }
    }
}

#[tauri::command]
pub async fn start_session(app: AppHandle, path: String) -> Result<(), String> {
    let claude_bin = {
        let state = app.state::<AppState>();
        let cfg = state.config.lock().map_err(|e| e.to_string())?;
        cfg.claude_path.clone().unwrap_or_else(|| "claude".to_string())
    };

    let history = load_recent_pairs(&path).unwrap_or_default();
    app.emit("session:history", &history).map_err(|e| e.to_string())?;

    let resume = {
        let state = app.state::<AppState>();
        state.session_id.lock().map_err(|e| e.to_string())?.clone()
    };
    let app_for_events = app.clone();
    let handle = spawn_claude(&claude_bin, &path, resume.as_deref(), move |ev| {
        dispatch_event(&app_for_events, ev);
    }).await?;

    let state = app.state::<AppState>();
    *state.process.lock().map_err(|e| e.to_string())? = Some(handle);
    Ok(())
}

async fn send_to_stdin(app: &AppHandle, msg: StdinMessage) -> Result<(), String> {
    let tx: Sender<StdinMessage> = {
        let state = app.state::<AppState>();
        let guard = state.process.lock().map_err(|e| e.to_string())?;
        guard.as_ref().ok_or("no active session")?.stdin_tx.clone()
    };
    tx.send(msg).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn send_user_message(app: AppHandle, text: String) -> Result<(), String> {
    send_to_stdin(&app, StdinMessage::User { content: text }).await
}

#[derive(Deserialize)]
pub struct ToolResponseArgs { pub request_id: String, pub allow: bool }

#[tauri::command]
pub async fn send_tool_response(app: AppHandle, args: ToolResponseArgs) -> Result<(), String> {
    let behavior = if args.allow { PermissionBehavior::Allow } else { PermissionBehavior::Deny };
    send_to_stdin(&app, StdinMessage::ToolPermissionResponse {
        request_id: args.request_id, behavior,
    }).await
}

#[tauri::command]
pub async fn send_control(app: AppHandle, action: String) -> Result<(), String> {
    send_to_stdin(&app, StdinMessage::Control { action }).await
}

#[tauri::command]
pub fn get_config(state: State<AppState>) -> Result<Config, String> {
    Ok(state.config.lock().map_err(|e| e.to_string())?.clone())
}

#[tauri::command]
pub fn set_config(config: Config, state: State<AppState>) -> Result<(), String> {
    config.save()?;
    *state.config.lock().map_err(|e| e.to_string())? = config;
    Ok(())
}
```

- [ ] **Step 2: Wire handlers in lib.rs**

Replace `src-tauri/src/lib.rs`:
```rust
pub mod claude_process;
pub mod config;
pub mod commands;
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
            commands::send_control,
            commands::get_config,
            commands::set_config,
        ])
        .run(tauri::generate_context!())
        .expect("error running meecode");
}
```

- [ ] **Step 3: cargo check + existing tests**

```bash
cd src-tauri && cargo check && cargo test
```
Expected: clean compile, all existing tests (protocol, stdout_parser, stdin_writer, history) PASS.

- [ ] **Step 4: Commit**

```bash
git add src-tauri/src/commands.rs src-tauri/src/lib.rs
git commit -m "$(cat <<'EOF'
feat(rust): rewrite Tauri commands around stream-json process

start_session/send_user_message/send_tool_response/send_control 네 명령으로 재정리하고 자식 프로세스의 DomainEvent를 session:* 이벤트로 emit한다.
EOF
)"
```

---

## Task 9: Frontend types and `useClaudeSession` hook (TDD)

**Files:**
- Modify: `src/types.ts`
- Create: `src/hooks/useClaudeSession.ts`
- Create: `src/hooks/useClaudeSession.test.ts`
- Delete: `src/hooks/usePtyStream.ts`, `src/hooks/usePtyStream.test.ts`

- [ ] **Step 1: Extend `src/types.ts`**

Append to `src/types.ts`:
```ts
export interface ToolRequest {
  request_id: string
  tool_name: string
  input: unknown
}

export type Mode = 'default' | 'plan' | 'auto-accept'
```

- [ ] **Step 2: Write the failing test**

Create `src/hooks/useClaudeSession.test.ts`:
```ts
import { describe, it, expect, vi } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'
import { useClaudeSession } from './useClaudeSession'
import type { QaPair, ToolRequest } from '../types'

type Handler = (event: { payload: unknown }) => void
const listeners: Record<string, Handler[]> = {}

vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn((evt: string, cb: Handler) => {
    (listeners[evt] ??= []).push(cb)
    return Promise.resolve(() => {
      listeners[evt] = (listeners[evt] || []).filter((h) => h !== cb)
    })
  }),
}))
vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn().mockResolvedValue(undefined),
}))

const fire = (evt: string, payload: unknown) =>
  (listeners[evt] || []).forEach((cb) => cb({ payload }))

const pair = (id: string): QaPair => ({ id, user_text: 'q', segments: [], timestamp: 't' })

describe('useClaudeSession', () => {
  it('초기 상태', () => {
    const { result } = renderHook(() => useClaudeSession())
    expect(result.current.pairs).toEqual([])
    expect(result.current.pendingTool).toBeNull()
    expect(result.current.mode).toBe('default')
    expect(result.current.error).toBeNull()
  })

  it('session:history로 pairs 초기화', async () => {
    const { result } = renderHook(() => useClaudeSession())
    await waitFor(() => expect(listeners['session:history']?.length).toBeGreaterThan(0))
    act(() => fire('session:history', [pair('a')]))
    expect(result.current.pairs).toHaveLength(1)
  })

  it('session:tool_request로 pendingTool 설정', async () => {
    const { result } = renderHook(() => useClaudeSession())
    await waitFor(() => expect(listeners['session:tool_request']?.length).toBeGreaterThan(0))
    const req: ToolRequest = { request_id: 'r1', tool_name: 'Bash', input: { command: 'ls' } }
    act(() => fire('session:tool_request', req))
    expect(result.current.pendingTool).toEqual(req)
  })

  it('session:mode_change로 mode 갱신', async () => {
    const { result } = renderHook(() => useClaudeSession())
    await waitFor(() => expect(listeners['session:mode_change']?.length).toBeGreaterThan(0))
    act(() => fire('session:mode_change', { mode: 'plan' }))
    expect(result.current.mode).toBe('plan')
  })

  it('session:error로 에러 설정', async () => {
    const { result } = renderHook(() => useClaudeSession())
    await waitFor(() => expect(listeners['session:error']?.length).toBeGreaterThan(0))
    act(() => fire('session:error', { message: 'boom' }))
    expect(result.current.error).toBe('boom')
  })
})
```

- [ ] **Step 3: Run test to verify it fails**

```bash
npm test -- src/hooks/useClaudeSession.test.ts
```
Expected: module-not-found.

- [ ] **Step 4: Implement hook**

Create `src/hooks/useClaudeSession.ts`:
```ts
import { useCallback, useEffect, useState } from 'react'
import { listen } from '@tauri-apps/api/event'
import { invoke } from '@tauri-apps/api/core'
import type { Mode, QaPair, ToolRequest } from '../types'

interface SessionState {
  pairs: QaPair[]
  pendingTool: ToolRequest | null
  mode: Mode
  error: string | null
}

interface Result extends SessionState {
  sendUserMessage: (text: string) => Promise<void>
  respondTool: (requestId: string, allow: boolean) => Promise<void>
  cycleMode: () => Promise<void>
  interrupt: () => Promise<void>
  sendEsc: () => Promise<void>
}

export function useClaudeSession(): Result {
  const [state, setState] = useState<SessionState>({
    pairs: [], pendingTool: null, mode: 'default', error: null,
  })

  useEffect(() => {
    const unlistens: Array<Promise<() => void>> = []
    unlistens.push(listen<QaPair[]>('session:history', (e) =>
      setState((s) => ({ ...s, pairs: e.payload }))))
    unlistens.push(listen<QaPair>('session:message', (e) =>
      setState((s) => {
        const incoming = e.payload
        const last = s.pairs[s.pairs.length - 1]
        if (last && last.id === incoming.id) {
          return { ...s, pairs: [...s.pairs.slice(0, -1), incoming] }
        }
        if (s.pairs.some((p) => p.id === incoming.id)) return s
        return { ...s, pairs: [...s.pairs, incoming] }
      })))
    unlistens.push(listen<ToolRequest>('session:tool_request', (e) =>
      setState((s) => ({ ...s, pendingTool: e.payload }))))
    unlistens.push(listen<{ mode: Mode }>('session:mode_change', (e) =>
      setState((s) => ({ ...s, mode: e.payload.mode }))))
    unlistens.push(listen<{ message: string }>('session:error', (e) =>
      setState((s) => ({ ...s, error: e.payload.message }))))
    return () => { unlistens.forEach((p) => p.then((fn) => fn())) }
  }, [])

  const sendUserMessage = useCallback(async (text: string) => {
    await invoke('send_user_message', { text })
  }, [])
  const respondTool = useCallback(async (requestId: string, allow: boolean) => {
    await invoke('send_tool_response', { args: { request_id: requestId, allow } })
    setState((s) => ({ ...s, pendingTool: null }))
  }, [])
  const cycleMode = useCallback(async () => {
    await invoke('send_control', { action: 'cycle_mode' })
  }, [])
  const interrupt = useCallback(async () => {
    await invoke('send_control', { action: 'interrupt' })
  }, [])
  const sendEsc = useCallback(async () => {
    await invoke('send_control', { action: 'esc' })
  }, [])

  return { ...state, sendUserMessage, respondTool, cycleMode, interrupt, sendEsc }
}
```

- [ ] **Step 5: Delete old hook + run tests**

```bash
git rm src/hooks/usePtyStream.ts src/hooks/usePtyStream.test.ts
npm test -- src/hooks/useClaudeSession.test.ts
```
Expected: 5/5 PASS.

- [ ] **Step 6: Commit**

```bash
git add src/types.ts src/hooks/useClaudeSession.ts src/hooks/useClaudeSession.test.ts
git commit -m "$(cat <<'EOF'
feat(hooks): add useClaudeSession over stream-json events

session:* 이벤트를 받아 pairs/pendingTool/mode/error를 reduce하고 도메인 명령을 invoke로 보내는 단일 훅을 추가한다. usePtyStream은 제거한다.
EOF
)"
```

---

## Task 10: `ToolApprovalCard` component (TDD)

**Files:**
- Create: `src/components/ToolApprovalCard/index.tsx`
- Create: `src/components/ToolApprovalCard/ToolApprovalCard.css`
- Create: `src/components/ToolApprovalCard/ToolApprovalCard.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import { ToolApprovalCard } from './index'
import type { ToolRequest } from '../../types'

const req: ToolRequest = { request_id: 'r1', tool_name: 'Edit', input: { file_path: '/x/y.ts' } }

describe('ToolApprovalCard', () => {
  it('도구 이름과 입력 요약을 표시', () => {
    render(<ToolApprovalCard request={req} onRespond={() => {}} />)
    expect(screen.getByText('Edit')).toBeInTheDocument()
    expect(screen.getByText(/\/x\/y\.ts/)).toBeInTheDocument()
  })

  it('"허용" 클릭 시 onRespond(true)', () => {
    const onRespond = vi.fn()
    render(<ToolApprovalCard request={req} onRespond={onRespond} />)
    fireEvent.click(screen.getByRole('button', { name: '허용' }))
    expect(onRespond).toHaveBeenCalledWith(true)
  })

  it('"거부" 클릭 시 onRespond(false)', () => {
    const onRespond = vi.fn()
    render(<ToolApprovalCard request={req} onRespond={onRespond} />)
    fireEvent.click(screen.getByRole('button', { name: '거부' }))
    expect(onRespond).toHaveBeenCalledWith(false)
  })
})
```

- [ ] **Step 2: Run test (fails)**

```bash
npm test -- src/components/ToolApprovalCard
```

- [ ] **Step 3: Implement**

Create `src/components/ToolApprovalCard/index.tsx`:
```tsx
import type { ToolRequest } from '../../types'
import './ToolApprovalCard.css'

interface Props {
  request: ToolRequest
  onRespond: (allow: boolean) => void
}

function summarize(input: unknown): string {
  if (!input || typeof input !== 'object') return ''
  const obj = input as Record<string, unknown>
  const candidates = ['command', 'file_path', 'pattern', 'query', 'url', 'description']
  for (const key of candidates) {
    const v = obj[key]
    if (typeof v === 'string' && v) return v
  }
  return JSON.stringify(obj).slice(0, 200)
}

export function ToolApprovalCard({ request, onRespond }: Props) {
  return (
    <section className="tool-approval-card" role="region" aria-label="도구 승인 요청">
      <header className="tool-approval-card__header">
        <span className="tool-approval-card__icon" aria-hidden="true">⚙️</span>
        <span className="tool-approval-card__name">{request.tool_name}</span>
      </header>
      <pre className="tool-approval-card__summary">{summarize(request.input)}</pre>
      <div className="tool-approval-card__buttons">
        <button type="button" className="tool-approval-card__deny" onClick={() => onRespond(false)}>
          거부
        </button>
        <button type="button" className="tool-approval-card__allow" onClick={() => onRespond(true)}>
          허용
        </button>
      </div>
    </section>
  )
}
```

Create `src/components/ToolApprovalCard/ToolApprovalCard.css`:
```css
.tool-approval-card {
  border: 1px solid #d29922;
  border-left: 4px solid #d29922;
  border-radius: 10px;
  background: #1f1a0a;
  padding: 12px 14px;
  margin: 12px 8px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.tool-approval-card__header { display: flex; gap: 8px; align-items: center; font-size: 13px; color: #d29922; font-weight: 700; }
.tool-approval-card__name { font-family: 'Menlo', 'Monaco', monospace; }
.tool-approval-card__summary {
  margin: 0; padding: 8px 10px; background: #0d1117; border: 1px solid #30363d; border-radius: 6px;
  color: #c9d1d9; font-family: 'Menlo', 'Monaco', monospace; font-size: 12px; white-space: pre-wrap;
  max-height: 8em; overflow: auto;
}
.tool-approval-card__buttons { display: flex; gap: 8px; justify-content: flex-end; }
.tool-approval-card__deny, .tool-approval-card__allow {
  border: 1px solid #30363d; border-radius: 6px; padding: 6px 14px; font-size: 13px; cursor: pointer;
}
.tool-approval-card__deny { background: transparent; color: #c9d1d9; }
.tool-approval-card__deny:hover { background: #30363d; }
.tool-approval-card__allow { background: #1f6feb; color: #fff; border-color: #1f6feb; }
.tool-approval-card__allow:hover { background: #388bfd; }
```

- [ ] **Step 4: Run test (passes)**

```bash
npm test -- src/components/ToolApprovalCard
```
Expected: 3/3 PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/ToolApprovalCard/
git commit -m "$(cat <<'EOF'
feat(tool-approval-card): add inline approval card for stream-json tool requests

도구 이름·입력 요약·허용/거부 버튼을 가진 인라인 승인 카드를 추가한다. 거부 버튼이 왼쪽에 와 실수 방지.
EOF
)"
```

---

## Task 11: `ChatComposer` rewrite (TDD)

**Files:**
- Modify: `src/components/ChatComposer/index.tsx`
- Modify: `src/components/ChatComposer/ChatComposer.test.tsx`

- [ ] **Step 1: Rewrite the test**

Replace `src/components/ChatComposer/ChatComposer.test.tsx` with:
```tsx
import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ChatComposer } from './index'

const handlers = {
  sendUserMessage: vi.fn().mockResolvedValue(undefined),
  cycleMode: vi.fn().mockResolvedValue(undefined),
  interrupt: vi.fn().mockResolvedValue(undefined),
  sendEsc: vi.fn().mockResolvedValue(undefined),
}

beforeEach(() => Object.values(handlers).forEach((h) => h.mockClear()))

describe('ChatComposer', () => {
  it('Enter 시 sendUserMessage 호출 (CR 없음)', () => {
    render(<ChatComposer mode="default" disabled={false} {...handlers} />)
    const ta = screen.getByRole('textbox') as HTMLTextAreaElement
    fireEvent.change(ta, { target: { value: 'hello' } })
    fireEvent.keyDown(ta, { key: 'Enter' })
    expect(handlers.sendUserMessage).toHaveBeenCalledWith('hello')
  })

  it('Shift+Enter는 줄바꿈만', () => {
    render(<ChatComposer mode="default" disabled={false} {...handlers} />)
    const ta = screen.getByRole('textbox')
    fireEvent.change(ta, { target: { value: 'hi' } })
    fireEvent.keyDown(ta, { key: 'Enter', shiftKey: true })
    expect(handlers.sendUserMessage).not.toHaveBeenCalled()
  })

  it('Shift+Tab 키 → cycleMode', () => {
    render(<ChatComposer mode="default" disabled={false} {...handlers} />)
    fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Tab', shiftKey: true })
    expect(handlers.cycleMode).toHaveBeenCalled()
  })

  it('ESC 키 → sendEsc', () => {
    render(<ChatComposer mode="default" disabled={false} {...handlers} />)
    fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Escape' })
    expect(handlers.sendEsc).toHaveBeenCalled()
  })

  it('IME composition 중 Enter 차단', () => {
    render(<ChatComposer mode="default" disabled={false} {...handlers} />)
    const ta = screen.getByRole('textbox')
    fireEvent.compositionStart(ta)
    fireEvent.change(ta, { target: { value: '한' } })
    fireEvent.keyDown(ta, { key: 'Enter', keyCode: 229 })
    expect(handlers.sendUserMessage).not.toHaveBeenCalled()
  })

  it('mode prop이 인디케이터에 표시', () => {
    render(<ChatComposer mode="plan" disabled={false} {...handlers} />)
    expect(screen.getByText(/Plan/)).toBeInTheDocument()
  })

  it('disabled일 때 textarea 비활성화', () => {
    render(<ChatComposer mode="default" disabled={true} {...handlers} />)
    expect(screen.getByRole('textbox')).toBeDisabled()
  })

  it('sendUserMessage 실패 시 텍스트 보존', async () => {
    handlers.sendUserMessage.mockRejectedValueOnce(new Error('pipe closed'))
    render(<ChatComposer mode="default" disabled={false} {...handlers} />)
    const ta = screen.getByRole('textbox') as HTMLTextAreaElement
    fireEvent.change(ta, { target: { value: 'q' } })
    fireEvent.keyDown(ta, { key: 'Enter' })
    await new Promise((r) => setTimeout(r, 0))
    expect(ta.value).toBe('q')
    expect(screen.getByRole('alert').textContent).toContain('pipe closed')
  })

  it('Ctrl+C 버튼 → interrupt', () => {
    render(<ChatComposer mode="default" disabled={false} {...handlers} />)
    fireEvent.click(screen.getByRole('button', { name: 'Ctrl+C' }))
    expect(handlers.interrupt).toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run test (fails)**

```bash
npm test -- src/components/ChatComposer
```

- [ ] **Step 3: Rewrite ChatComposer**

Replace `src/components/ChatComposer/index.tsx`:
```tsx
import { useRef, useState } from 'react'
import type { Mode } from '../../types'
import './ChatComposer.css'

const MODE_LABEL: Record<Mode, string> = {
  default: '⏎ 기본 모드',
  plan: '📋 Plan 모드',
  'auto-accept': '⚡ Auto-accept 모드',
}

interface Props {
  mode: Mode
  disabled: boolean
  sendUserMessage: (text: string) => Promise<void>
  cycleMode: () => Promise<void>
  interrupt: () => Promise<void>
  sendEsc: () => Promise<void>
}

export function ChatComposer({ mode, disabled, sendUserMessage, cycleMode, interrupt, sendEsc }: Props) {
  const [value, setValue] = useState('')
  const [error, setError] = useState<string | null>(null)
  const isComposingRef = useRef(false)

  const submit = async () => {
    if (!value) return
    const snapshot = value
    setError(null)
    try {
      await sendUserMessage(snapshot)
      setValue('')
    } catch (e) {
      setError(String(e))
    }
  }

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (isComposingRef.current || e.keyCode === 229 || (e.nativeEvent as KeyboardEvent).isComposing) return
    if (e.key === 'Tab' && e.shiftKey) { e.preventDefault(); cycleMode().catch((x) => setError(String(x))); return }
    if (e.key === 'Escape') { e.preventDefault(); sendEsc().catch((x) => setError(String(x))); return }
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit() }
  }

  return (
    <div className="chat-composer">
      {error && <div role="alert" className="chat-composer__error">{error}</div>}
      <div className="chat-composer__row">
        <textarea
          className="chat-composer__textarea"
          value={value}
          disabled={disabled}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={onKeyDown}
          onCompositionStart={() => { isComposingRef.current = true }}
          onCompositionEnd={() => { isComposingRef.current = false }}
          placeholder={disabled ? '도구 승인을 먼저 처리하세요…' : '메시지를 입력하세요 (Enter 전송 · Shift+Enter 줄바꿈)'}
          rows={2}
        />
        <div className="chat-composer__buttons">
          <button type="button" onClick={() => sendEsc().catch((e) => setError(String(e)))}>ESC</button>
          <button type="button" onClick={() => cycleMode().catch((e) => setError(String(e)))}>Shift+Tab</button>
          <button type="button" onClick={() => interrupt().catch((e) => setError(String(e)))}>Ctrl+C</button>
        </div>
      </div>
      <div className="chat-composer__status" data-mode={mode}>{MODE_LABEL[mode]}</div>
    </div>
  )
}
```

- [ ] **Step 4: Run test (passes)**

```bash
npm test -- src/components/ChatComposer
```
Expected: 9/9 PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/ChatComposer/
git commit -m "$(cat <<'EOF'
refactor(chat-composer): drive composer via domain handlers and prop-passed mode

PTY-shaped \\r/escape 전송과 mode mirror를 폐기하고 sendUserMessage/cycleMode/sendEsc/interrupt를 호출하는 dumb 컴포넌트로 단순화한다.
EOF
)"
```

---

## Task 12: `ChatStream` accepts `pendingTool` (TDD)

**Files:**
- Modify: `src/components/ChatStream/index.tsx`
- Modify: `src/components/ChatStream/ChatStream.test.tsx`

- [ ] **Step 1: Extend test**

Add at the bottom of `src/components/ChatStream/ChatStream.test.tsx`:
```tsx
import { ToolApprovalCard } from '../ToolApprovalCard'
import type { ToolRequest } from '../../types'

it('pendingTool prop 있으면 ToolApprovalCard 렌더', () => {
  const req: ToolRequest = { request_id: 'r1', tool_name: 'Edit', input: { file_path: '/x' } }
  render(
    <ChatStream
      pairs={[pair('a', 'q', [text('answer')])]}
      onExpand={() => {}}
      pendingTool={req}
      onRespondTool={() => {}}
    />
  )
  expect(screen.getByRole('region', { name: '도구 승인 요청' })).toBeInTheDocument()
})

it('도구 승인 버튼 클릭 시 onRespondTool 호출', () => {
  const onRespondTool = vi.fn()
  const req: ToolRequest = { request_id: 'r1', tool_name: 'Edit', input: {} }
  render(
    <ChatStream pairs={[]} onExpand={() => {}} pendingTool={req} onRespondTool={onRespondTool} />
  )
  fireEvent.click(screen.getByRole('button', { name: '허용' }))
  expect(onRespondTool).toHaveBeenCalledWith('r1', true)
})
```

Also update existing test invocations to pass `pendingTool={null}` and `onRespondTool={() => {}}` so the new required props are satisfied.

- [ ] **Step 2: Update ChatStream**

Replace `src/components/ChatStream/index.tsx`:
```tsx
import { useEffect, useRef } from 'react'
import { QaCard } from '../QaCard'
import { ToolApprovalCard } from '../ToolApprovalCard'
import type { QaPair, ToolRequest } from '../../types'
import './ChatStream.css'

interface Props {
  pairs: QaPair[]
  onExpand: (id: string) => void
  pendingTool: ToolRequest | null
  onRespondTool: (requestId: string, allow: boolean) => void
}

export function ChatStream({ pairs, onExpand, pendingTool, onRespondTool }: Props) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const shouldAutoScrollRef = useRef(true)
  const userScrolledRef = useRef(false)

  useEffect(() => {
    if (!shouldAutoScrollRef.current || !scrollRef.current) return
    const el = scrollRef.current
    el.scrollTop = el.scrollHeight
  }, [pairs, pendingTool])

  const handleScroll = () => {
    const el = scrollRef.current
    if (!el) return
    const atBottom = Math.abs(el.scrollHeight - el.scrollTop - el.clientHeight) < 50
    if (!atBottom) { userScrolledRef.current = true; shouldAutoScrollRef.current = false }
    else if (userScrolledRef.current) { shouldAutoScrollRef.current = true; userScrolledRef.current = false }
  }

  if (pairs.length === 0 && !pendingTool) {
    return (
      <div className="chat-stream chat-stream--empty">
        <p>프로젝트가 시작되었습니다. 아래에서 첫 질문을 입력하세요.</p>
      </div>
    )
  }

  const last = pairs[pairs.length - 1]
  const lastSeg = last?.segments[last.segments.length - 1]
  const indicator = !pendingTool && last
    ? (last.segments.length === 0
        ? 'Claude가 응답 대기 중…'
        : lastSeg && lastSeg.kind === 'tool_use'
        ? 'Claude가 도구를 실행 중…'
        : null)
    : null

  return (
    <div ref={scrollRef} className="chat-stream" onScroll={handleScroll}>
      {pairs.map((p) => (
        <QaCard key={p.id} pair={p} onExpand={() => onExpand(p.id)} />
      ))}
      {pendingTool && (
        <ToolApprovalCard
          request={pendingTool}
          onRespond={(allow) => onRespondTool(pendingTool.request_id, allow)}
        />
      )}
      {indicator && <div className="chat-stream__status">{indicator}</div>}
    </div>
  )
}
```

- [ ] **Step 3: Run test (passes)**

```bash
npm test -- src/components/ChatStream
```
Expected: existing + 2 new = 7/7 PASS.

- [ ] **Step 4: Commit**

```bash
git add src/components/ChatStream/
git commit -m "$(cat <<'EOF'
feat(chat-stream): render inline ToolApprovalCard when a tool request is pending

pendingTool prop이 있으면 카드 흐름 끝에 인라인 승인 카드를 추가하고 진행 인디케이터는 그 동안 잠금한다.
EOF
)"
```

---

## Task 13: `App.tsx` wire + cleanup

**Files:**
- Modify: `src/App.tsx`

- [ ] **Step 1: Rewire App.tsx**

Replace `src/App.tsx`:
```tsx
import { useMemo, useState } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { open } from '@tauri-apps/plugin-dialog'
import { Panel, PanelGroup, PanelResizeHandle } from 'react-resizable-panels'
import { ChatStream } from './components/ChatStream'
import { ChatComposer } from './components/ChatComposer'
import { ExpandPane } from './components/ExpandPane'
import { useClaudeSession } from './hooks/useClaudeSession'
import { useExpandPanel } from './hooks/useExpandPanel'
import './App.css'

function FolderPicker({ onStart }: { onStart: (path: string) => void }) {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const handleSelect = async () => {
    const selected = await open({ directory: true, multiple: false })
    if (!selected || typeof selected !== 'string') return
    setLoading(true); setError('')
    try { await invoke('start_session', { path: selected }); onStart(selected) }
    catch (e) { setError(String(e)) } finally { setLoading(false) }
  }
  return (
    <div className="folder-picker">
      <div className="folder-picker__card">
        <div className="folder-picker__logo">M</div>
        <h1 className="folder-picker__title">MeeCode</h1>
        <p className="folder-picker__desc">프로젝트 폴더를 선택하면 Claude Code가 해당 디렉토리에서 실행됩니다.</p>
        <button className="folder-picker__btn" onClick={handleSelect} disabled={loading}>
          {loading ? '시작 중...' : '📂 프로젝트 폴더 선택'}
        </button>
        {error && <p className="folder-picker__error">{error}</p>}
      </div>
    </div>
  )
}

function MainLayout({ projectPath }: { projectPath: string }) {
  const session = useClaudeSession()
  const { expandedId, setExpandedId, isOpen, toggleOpen, autoExpand, setAutoExpand } = useExpandPanel(session.pairs)
  const expandedPair = useMemo(
    () => session.pairs.find((p) => p.id === expandedId) ?? null,
    [session.pairs, expandedId]
  )
  const handleExpand = (id: string) => { setExpandedId(id); if (!isOpen) toggleOpen() }

  return (
    <div className="app">
      <div className="app__header">
        <span className="app__path">{projectPath}</span>
        {!isOpen && expandedId !== null && (
          <button type="button" className="app__reopen-btn" aria-label="펼쳐보기 패널 열기" onClick={toggleOpen}>
            ◀ 패널 열기
          </button>
        )}
        <label className="app__auto-toggle">
          <input type="checkbox" checked={autoExpand} onChange={(e) => setAutoExpand(e.target.checked)} />
          긴 답변 자동 펼침
        </label>
      </div>
      {session.error && <div role="alert" className="app__error">{session.error}</div>}
      <div className="app__body">
        <PanelGroup direction="horizontal">
          <Panel defaultSize={isOpen ? 60 : 100} minSize={30}>
            <div className="app__chat">
              <ChatStream
                pairs={session.pairs}
                onExpand={handleExpand}
                pendingTool={session.pendingTool}
                onRespondTool={(id, allow) => session.respondTool(id, allow)}
              />
              <ChatComposer
                mode={session.mode}
                disabled={session.pendingTool !== null}
                sendUserMessage={session.sendUserMessage}
                cycleMode={session.cycleMode}
                interrupt={session.interrupt}
                sendEsc={session.sendEsc}
              />
            </div>
          </Panel>
          {isOpen && (
            <>
              <PanelResizeHandle className="resize-handle" />
              <Panel defaultSize={40} minSize={20}>
                <ExpandPane pair={expandedPair} isOpen={isOpen} onToggle={toggleOpen} />
              </Panel>
            </>
          )}
        </PanelGroup>
      </div>
    </div>
  )
}

function App() {
  const [projectPath, setProjectPath] = useState<string | null>(null)
  if (!projectPath) return <FolderPicker onStart={setProjectPath} />
  return <MainLayout key={projectPath} projectPath={projectPath} />
}

export default App
```

Add a minimal style for `.app__error` to `src/App.css`:
```css
.app__error {
  background: #2b1416;
  color: #f85149;
  border-bottom: 1px solid #5d1f23;
  padding: 6px 14px;
  font-size: 12px;
}
```

- [ ] **Step 2: Run full test suite**

```bash
npm test
```
Expected: all tests PASS. If any frontend test still imports `usePtyStream`, that file is already deleted in Task 9 — fix the import or delete the stale test.

- [ ] **Step 3: Build**

```bash
npm run build
```
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/App.tsx src/App.css
git commit -m "$(cat <<'EOF'
feat(app): wire MeeCode UI to stream-json domain handlers

usePtyStream을 useClaudeSession으로 교체하고 ChatStream/ChatComposer/ExpandPane에 도메인 명령과 pendingTool 상태를 연결한다.
EOF
)"
```

---

## Task 14: Manual smoke test

**Files:** (no code change)

- [ ] **Step 1: Run dev**

```bash
npm run tauri dev
```

- [ ] **Step 2: Smoke checklist**

체크리스트:
- [ ] FolderPicker → 폴더 선택 → 메인 진입, 직전 세션 history가 즉시 보임
- [ ] 짧은 질문 → 응답이 streaming으로 카드에 누적됨
- [ ] 한글 IME로 질문 입력 → 자모 분리 없이 정상 전송
- [ ] Shift+Enter는 줄바꿈, Enter는 전송
- [ ] Shift+Tab 키 → 모드 인디케이터가 실제 모드 반영(`session:mode_change` 수신)
- [ ] ESC 키/버튼 → claude가 작업 중단
- [ ] Ctrl+C 버튼 → 인터럽트 발생
- [ ] **파일 Edit/Write 요청 시 ToolApprovalCard 인라인 표시 → "허용" 클릭 → 도구 실행 결과가 후속 segment로 도착**
- [ ] **승인 대기 중에는 textarea가 비활성화되고 placeholder가 "도구 승인을 먼저 처리하세요…"**
- [ ] 긴 답변 도착 시 ExpandPane 자동 펼침(autoExpand) 동작
- [ ] 우측 패널에서 텍스트 선택 → 코멘트 플로팅 동작 (Esc 키 또는 다른 코멘트와 충돌 없음)
- [ ] 앱 재시작 → 직전 세션 history 복원되고 같은 세션을 resume해서 계속됨
- [ ] `/help`, `/clear` 슬래시 명령이 user_message로 보내져도 claude가 처리하는지 확인

- [ ] **Step 3: 발견 이슈는 별도 fix task로 처리**

Plan은 여기서 종료. 발견된 이슈는 새 task로 추가 commit.

---

## Self-Review

**1. Spec coverage**
- Goal "PTY 폐기": Task 3 (deletes `pty_manager.rs` & `session_watcher.rs`) + Task 2 (cargo deps) ✓
- Goal "stdio JSON 단일 채널": Task 6 (`spawn_claude` with stream-json flags) + Tasks 4·5 ✓
- Goal "tool approval 인라인 카드": Task 10 (ToolApprovalCard) + Task 12 (ChatStream wires it) ✓
- Goal "실제 모드 추적": Task 9 hook + Task 13 wire `mode={session.mode}` ✓
- Goal "최근 jsonl을 history로 + resume": Task 7 (`load_recent_pairs`) + Task 8 (`start_session` emits history + passes `--resume`) ✓
- Goal "PTY 우회 작업 제거": Task 11 (ChatComposer rewrite, `\r`·`\x1b[Z` 제거) ✓
- Goal "기존 ExpandPane/코멘트 유지": 변경 없음(plan 명시) ✓

**2. Placeholder scan**
- Task 4 Step 3: "If NOTES.md shows different field names, use those instead" — implementation guidance, not placeholder ✓
- Task 4 Step 3: alternative implementations are explicitly listed and the "Final implementation" block ends the choice ✓
- Task 7 Step 2: "copy from git history at commit `7319ada`" — exact reference, copy-pasteable ✓
- No "TBD/TODO/implement later" patterns

**3. Type consistency**
- `StreamMessage`, `StdinMessage`, `PermissionBehavior` declared Task 3, used Tasks 4·5·8 — same enum variants and fields
- `DomainEvent` declared Task 4, used Task 6·8 — same variants
- `QaPair`, `AssistantSegment` ported Task 7, used Tasks 8·9
- `ToolRequest`, `Mode` declared Task 9 (types.ts), used Tasks 10·11·12·13 — same field names (`request_id`, `tool_name`, `input`)
- Hook return type matches App.tsx usage (Task 13): `sendUserMessage`, `cycleMode`, `interrupt`, `sendEsc`, `respondTool`, `pairs`, `pendingTool`, `mode`, `error`
- Tauri command names match between Rust (`start_session`, `send_user_message`, `send_tool_response`, `send_control`) and JS (`invoke` arguments use the same names + snake_case `args` for `send_tool_response`)
- Event names match: `session:history`, `session:message`, `session:tool_request`, `session:mode_change`, `session:error` (Rust `emit` → JS `listen`)

No inconsistencies found.
