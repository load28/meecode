# stream-json protocol notes (claude 2.1.143)

Confirmed by capture (`basic-turn.jsonl`, `tool-use.jsonl`) and reverse-engineering the
official VS Code extension (`anthropic.claude-code-2.1.143-darwin-arm64/extension.js`).

## Spawn flags MeeCode uses

```
claude
  --output-format stream-json
  --input-format  stream-json
  --verbose
  --permission-prompt-tool stdio        # hidden flag, not in `claude --help`
  --include-partial-messages            # emit Anthropic SSE deltas (stream_event)
  --include-hook-events                 # surface system:hook_* lifecycle
  [--resume <session_id>]
```

`--permission-prompt-tool stdio` is the lever that makes claude emit `control_request`
messages on stdout instead of printing y/n prompts to a TTY. It is not present in
`claude --help` output but the extension wires it whenever its `canUseTool` callback is
registered.

## Stream-out top-level message types (claude → us)

| `type` | when | key fields |
|---|---|---|
| `system` (`subtype:"init"`) | session start | `session_id`, `permissionMode`, `model`, `tools`, `mcp_servers`, `slash_commands`, ... |
| `system` (`subtype:"hook_started"\|"hook_response"\|"hook_progress"`) | hook lifecycle | `hook_id`, `hook_name`, `output` |
| `assistant` | assistant turn | `message.content[]` with `type:"text"\|"thinking"\|"tool_use"`, `session_id`, `uuid`, `request_id` |
| `user` | tool_result echo or replayed input | `message.content[]` with `type:"tool_result"\|"text"` |
| `result` (`subtype:"success"`) | end of one assistant pass | `result`, `duration_ms`, `total_cost_usd`, `session_id` |
| `rate_limit_event` | rate limit hit/notice | varies |
| `control_request` | claude asks us something | `request_id`, `request.{ subtype, ... }` |
| `control_response` | claude answers our previous control request | `response.{ subtype, request_id, response }` |
| `control_cancel_request` | claude cancels a pending request | `request_id` |
| `keep_alive` | heartbeat | none |
| `transcript_mirror` | mirroring session jsonl | `filePath`, `entries` |
| `stream_event` | per-token SSE delta (with `--include-partial-messages`) | `event.{type,...}`, `parent_tool_use_id?`, `uuid`, `session_id` |
| `tool_progress` | long-running-tool heartbeat | `tool_use_id`, `tool_name`, `phase?`, `elapsed_time_seconds?`, `last_tool_name?`, `parent_tool_use_id?` |
| `system` (`subtype:"task_started"\|"task_progress"\|"task_notification"`) | background-agent task lifecycle | `task_id`, `description`, `task_type`, `status?`, `usage?` |

### `stream_event` sub-shapes

The `event` field holds the raw Anthropic message-streaming SSE event:

- `message_start` — `{ message: { id, role, model, content: [], ... } }`
- `content_block_start` — `{ index, content_block: { type: "text"|"thinking"|"tool_use", ... } }`
- `content_block_delta` — `{ index, delta: { type: "text_delta"|"thinking_delta"|"input_json_delta"|"signature_delta", ... } }`
- `content_block_stop` — `{ index }`
- `message_delta` — `{ delta: { stop_reason, ... } }`
- `message_stop` — `{}`

`parent_tool_use_id` on the envelope routes subagent inner activity into the parent `Agent`/`Task` tool_use card. Subagents can nest — children carry their own `parent_tool_use_id` of the inner agent.

### Aggregated `assistant`/`user` vs `stream_event`

When `--include-partial-messages` is on, the **same** thinking/text content arrives twice: once incrementally as `stream_event.content_block_delta` (token-by-token, used to render the live "Thinking…" stream), then once aggregated in the trailing `assistant` message. MeeCode dedupes by checking whether the segment list's tail is a streamed segment (`partial` field defined) — if yes, the aggregated message's `thinking` / `text` blocks are dropped and only `tool_use` / `image` / `plan` are appended.

## `control_request` with `can_use_tool`

```json
{
  "type": "control_request",
  "request_id": "<server-side id>",
  "request": {
    "subtype": "can_use_tool",
    "tool_name": "Edit",
    "input": { "file_path": "/x/y.ts", "old_string": "...", "new_string": "..." },
    "tool_use_id": "<tool use id from the assistant message>",
    "permission_suggestions": [ ... ],
    "blocked_path": "...",
    "decision_reason": "...",
    "title": "...",
    "display_name": "...",
    "description": "..."
  }
}
```

All non-`subtype` fields are optional in practice.

## Stream-in message types (we → claude)

### User message

```json
{
  "type": "user",
  "session_id": "",
  "message": {
    "role": "user",
    "content": [{ "type": "text", "text": "Read note.txt" }]
  }
}
```

`session_id` can be empty when starting fresh; the SDK handles attaching it later.
`content` is an array of content blocks (text, image, etc.).

### Control response (answering `can_use_tool`)

```json
{
  "type": "control_response",
  "response": {
    "subtype": "success",
    "request_id": "<same as the original control_request.request_id>",
    "response": {
      "behavior": "allow",
      "toolUseID": "<from request.tool_use_id>"
    }
  }
}
```

Replace `"allow"` with `"deny"` to refuse. Additional behavior payloads (e.g. edited
input) may exist but for MVP we only need allow/deny.

## What we deliberately ignore

- `keep_alive`: noop
- `transcript_mirror`: not used for live UI, jsonl loader handles history separately
- `system.hook_*`: extension-side hooks; not for end-user UI
- `rate_limit_event`: surface only as `session:error` if it indicates a hard block

## What is captured here

- `basic-turn.jsonl` — `What is 2+2?` (no tool use). Shows `system:init`, an `assistant.content[]` with `text`, and `result:success`.
- `tool-use.jsonl` — `Read note.txt and tell me its content` with `--permission-mode default`. Shows `assistant.content[]` `thinking` → `tool_use`, `user.content[]` `tool_result`, then `assistant.content[]` `text`, and `result`. **Captured without `--permission-prompt-tool stdio` so it does NOT contain a `control_request` line.** A future capture using `--input-format stream-json --permission-prompt-tool stdio` (driven by a small Node/Rust test harness) should be added once the spawn module exists.

## Sources

- Capture: `claude --print --output-format stream-json --verbose ...` on macOS, claude 2.1.143
- VS Code extension: `~/.vscode/extensions/anthropic.claude-code-2.1.143-darwin-arm64/extension.js`
  - `processControlRequest` body
  - `handleControlRequest` response wrapping
  - `--permission-prompt-tool` flag gating
- `claude --help` (does NOT mention `--permission-prompt-tool`)
