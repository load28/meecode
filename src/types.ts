export interface Config {
  markdown_threshold: number
  claude_path: string | null
}

export interface SelectionState {
  text: string
  rect: DOMRect | null
}

/**
 * Subagent inner message — emitted by the CLI with `parent_tool_use_id` set
 * to the parent `Agent`/`Task` tool_use id. We thread these onto the parent
 * tool_use segment so the UI can render a nested activity tree.
 */
export interface SubagentEntry {
  /** "assistant" | "user" — the role of the inner message. */
  role: 'assistant' | 'user'
  segments: AssistantSegment[]
}

export type AssistantSegment =
  | { kind: 'text'; text: string; partial?: boolean }
  | { kind: 'plan'; text: string }
  | {
      kind: 'thinking'
      text: string
      /** True while `content_block_delta` deltas are still arriving. */
      partial?: boolean
      /** ms elapsed between thinking start and stop. Set once partial flips false. */
      duration_ms?: number
    }
  | { kind: 'redacted_thinking' }
  | { kind: 'image'; media_type: string; data_url?: string }
  | {
      kind: 'tool_use'
      id: string
      name: string
      summary: string
      input: unknown
      /** Inner subagent messages routed via `parent_tool_use_id === id`. */
      children?: SubagentEntry[]
      /** Tool progress heartbeats: `{ phase, elapsed_seconds }`. */
      progress?: ToolProgressEntry[]
    }
  | { kind: 'tool_result'; tool_use_id: string; text: string; is_error: boolean }
  /**
   * Body of a freshly-loaded skill, echoed back as a user message by the
   * Claude Code CLI after the assistant invokes the `Skill` tool. We attach
   * it to the same pair that owns the Skill tool_use instead of letting the
   * reducer mint a brand-new question card.
   */
  | { kind: 'skill_body'; skill: string; text: string }

export interface ToolProgressEntry {
  /** "running" | "completed" | "failed" | ... */
  phase?: string
  /** Seconds since the tool started (server-reported). */
  elapsed_seconds?: number
  /** Last inner tool name when this is a nested-call heartbeat. */
  last_tool_name?: string
}

export interface SlashCommand {
  name: string
  description?: string
}

export interface QaPair {
  id: string
  user_text: string
  segments: AssistantSegment[]
  timestamp: string
}

export interface ToolRequest {
  request_id: string
  tool_name: string
  input: unknown
  tool_use_id: string | null
  permission_suggestions?: PermissionSuggestion[] | null
  decision_reason?: string | null
  blocked_path?: string | null
  title?: string | null
}

export interface PermissionSuggestion {
  type?: string
  destination?: string
  ruleContent?: string
  reason?: string
  label?: string
}

export type Mode = 'default' | 'plan' | 'auto-accept'

export interface Pin {
  id: string
  session_id: string | null
  qa_id: string | null
  segment_kind: string
  text: string
  picked_at_ms: number
  marker: string
}

export interface WikiFileMeta {
  name: string
  size_bytes: number
}

export interface WikiDiffEntry {
  name: string
  old_content: string
  new_content: string
}

export type OrganizeStatus = 'idle' | 'running' | 'diff-ready' | 'error'
