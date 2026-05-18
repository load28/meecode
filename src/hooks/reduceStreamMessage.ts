import type { AssistantSegment, QaPair } from '../types'

export interface StreamMessageEvent {
  kind: 'user' | 'assistant'
  uuid: string | null
  body: unknown
}

interface MessageState {
  pairs: QaPair[]
  currentId: string | null
}

const TOOL_INPUT_FIELDS: Record<string, string[]> = {
  Bash: ['command', 'description'],
  Read: ['file_path'],
  Edit: ['file_path'],
  Write: ['file_path'],
  NotebookEdit: ['file_path'],
  Skill: ['skill'],
  ToolSearch: ['query'],
  Grep: ['pattern'],
  Glob: ['pattern'],
  WebFetch: ['url', 'query'],
  WebSearch: ['url', 'query'],
  Agent: ['description', 'subagent_type'],
}

function summarizeToolInput(name: string, input: unknown): string {
  if (!input || typeof input !== 'object') return ''
  const obj = input as Record<string, unknown>
  const keys = TOOL_INPUT_FIELDS[name]
  let pick: string | null = null
  if (keys) {
    for (const k of keys) {
      const v = obj[k]
      if (typeof v === 'string' && v) {
        pick = v
        break
      }
    }
  } else {
    for (const v of Object.values(obj)) {
      if (typeof v === 'string' && v) {
        pick = v
        break
      }
    }
  }
  const firstLine = (pick ?? '').split('\n')[0].trim()
  return firstLine.length > 120 ? firstLine.slice(0, 120) + '…' : firstLine
}

function assistantSegmentsFrom(content: unknown): AssistantSegment[] {
  const segs: AssistantSegment[] = []
  if (typeof content === 'string') {
    if (content) segs.push({ kind: 'text', text: content })
    return segs
  }
  if (!Array.isArray(content)) return segs
  for (const item of content) {
    if (!item || typeof item !== 'object') continue
    const t = (item as Record<string, unknown>).type
    if (t === 'text') {
      const text = (item as Record<string, unknown>).text
      if (typeof text === 'string' && text) segs.push({ kind: 'text', text })
    } else if (t === 'tool_use') {
      const name = String((item as Record<string, unknown>).name ?? '')
      const input = (item as Record<string, unknown>).input
      if (name === 'ExitPlanMode') {
        const plan = (input as Record<string, unknown> | undefined)?.plan
        if (typeof plan === 'string' && plan) segs.push({ kind: 'plan', text: plan })
      } else if (name) {
        segs.push({ kind: 'tool_use', name, summary: summarizeToolInput(name, input) })
      }
    }
  }
  return segs
}

type UserContent = { kind: 'real'; text: string } | { kind: 'tool_result_only' }

function classifyUserContent(content: unknown): UserContent {
  if (typeof content === 'string') return { kind: 'real', text: content }
  if (!Array.isArray(content)) return { kind: 'real', text: '' }
  let text = ''
  let sawText = false
  let sawNonToolResult = false
  for (const item of content) {
    const t = (item as Record<string, unknown>)?.type
    if (t === 'text') {
      sawText = true
      sawNonToolResult = true
      const v = (item as Record<string, unknown>).text
      if (typeof v === 'string') {
        if (text) text += '\n'
        text += v
      }
    } else if (t === 'tool_result') {
      // ignore
    } else {
      sawNonToolResult = true
    }
  }
  if (content.length > 0 && !sawNonToolResult) return { kind: 'tool_result_only' }
  return { kind: 'real', text: sawText ? text : '' }
}

export function reduceStreamMessage(
  state: MessageState,
  ev: StreamMessageEvent,
): MessageState {
  const body = ev.body as Record<string, unknown> | null
  if (!body) return state
  const content = body.content

  if (ev.kind === 'user') {
    const classified = classifyUserContent(content)
    if (classified.kind === 'tool_result_only') return state
    if (!classified.text) return state
    const last = state.pairs[state.pairs.length - 1]
    if (last && last.user_text === classified.text && last.segments.length === 0) {
      // Treat as echo of the just-sent user message — keep the existing pair.
      return state
    }
    const id = ev.uuid || `idx-${state.pairs.length}`
    const newPair: QaPair = {
      id,
      user_text: classified.text,
      segments: [],
      timestamp: new Date().toISOString(),
    }
    return { pairs: [...state.pairs, newPair], currentId: id }
  }

  // assistant
  if (!state.currentId) return state
  const segs = assistantSegmentsFrom(content)
  if (segs.length === 0) return state
  const idx = state.pairs.findIndex((p) => p.id === state.currentId)
  if (idx === -1) return state
  const updated: QaPair = {
    ...state.pairs[idx],
    segments: [...state.pairs[idx].segments, ...segs],
  }
  const next = state.pairs.slice()
  next[idx] = updated
  return { pairs: next, currentId: state.currentId }
}

export function makeInitialMessageState(pairs: QaPair[]): MessageState {
  return {
    pairs,
    currentId: pairs.length > 0 ? pairs[pairs.length - 1].id : null,
  }
}
