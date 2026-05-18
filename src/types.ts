export interface Config {
  markdown_threshold: number
  claude_path: string | null
}

export interface SelectionState {
  text: string
  rect: DOMRect | null
}

export type AssistantSegment =
  | { kind: 'text'; text: string }
  | { kind: 'plan'; text: string }
  | { kind: 'tool_use'; name: string; summary: string }

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
}

export type Mode = 'default' | 'plan' | 'auto-accept'
