import type {
  AssistantSegment,
  QaPair,
  SubagentEntry,
  ToolProgressEntry,
} from '../types'

export interface StreamMessageEvent {
  kind: 'user' | 'assistant'
  uuid: string | null
  body: unknown
  /** Set when this message belongs to a subagent (Agent/Task) call. */
  parent_tool_use_id?: string | null
}

/**
 * One Anthropic SSE delta forwarded by claude when spawned with
 * `--include-partial-messages`. We use these to live-render thinking and
 * assistant text token-by-token instead of waiting for the aggregated
 * `assistant` message.
 */
export interface StreamPartialEvent {
  /** Raw event body: message_start | content_block_start | content_block_delta | content_block_stop | message_delta | message_stop */
  event: unknown
  /** Subagent routing: null/undefined when this is the root turn. */
  parent_tool_use_id?: string | null
}

/** Heartbeat for long-running tools (e.g. nested Agent activity). */
export interface ToolProgressPayload {
  tool_use_id?: string
  tool_name?: string
  phase?: string
  elapsed_time_seconds?: number
  last_tool_name?: string
  parent_tool_use_id?: string | null
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
    } else if (t === 'thinking') {
      const text = (item as Record<string, unknown>).thinking
      if (typeof text === 'string' && text) segs.push({ kind: 'thinking', text })
    } else if (t === 'redacted_thinking') {
      segs.push({ kind: 'redacted_thinking' })
    } else if (t === 'image') {
      const source = (item as Record<string, unknown>).source as
        | Record<string, unknown>
        | undefined
      const media =
        (typeof source?.media_type === 'string' && source.media_type) ||
        'image/*'
      segs.push({ kind: 'image', media_type: media })
    } else if (t === 'tool_use') {
      const name = String((item as Record<string, unknown>).name ?? '')
      const id = String((item as Record<string, unknown>).id ?? '')
      const input = (item as Record<string, unknown>).input
      if (name === 'ExitPlanMode') {
        const plan = (input as Record<string, unknown> | undefined)?.plan
        if (typeof plan === 'string' && plan) segs.push({ kind: 'plan', text: plan })
      } else if (name) {
        segs.push({
          kind: 'tool_use',
          id,
          name,
          summary: summarizeToolInput(name, input),
          input,
        })
      }
    }
  }
  return segs
}

function userToolResultsFromContent(content: unknown): AssistantSegment[] {
  if (!Array.isArray(content)) return []
  const out: AssistantSegment[] = []
  for (const item of content) {
    if (!item || typeof item !== 'object') continue
    const obj = item as Record<string, unknown>
    if (obj.type !== 'tool_result') continue
    const toolUseId = typeof obj.tool_use_id === 'string' ? obj.tool_use_id : ''
    const isError = obj.is_error === true
    const text = flattenToolResultText(obj.content)
    out.push({
      kind: 'tool_result',
      tool_use_id: toolUseId,
      text,
      is_error: isError,
    })
  }
  return out
}

function flattenToolResultText(content: unknown): string {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  const parts: string[] = []
  for (const item of content) {
    if (item && typeof item === 'object') {
      const obj = item as Record<string, unknown>
      if (obj.type === 'text' && typeof obj.text === 'string') {
        parts.push(obj.text)
      }
    }
  }
  return parts.join('\n')
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

/**
 * Locate the tool_use segment matching `parentToolUseId`, including nested
 * children — subagents can spawn further subagents.
 */
function appendToSubagent(
  segments: AssistantSegment[],
  parentId: string,
  entry: SubagentEntry,
): AssistantSegment[] | null {
  let changed = false
  const next = segments.map((seg) => {
    if (seg.kind !== 'tool_use') return seg
    if (seg.id === parentId) {
      changed = true
      const children = seg.children ? [...seg.children, entry] : [entry]
      return { ...seg, children }
    }
    if (seg.children && seg.children.length > 0) {
      let childChanged = false
      const newChildren = seg.children.map((child) => {
        const merged = appendToSubagent(child.segments, parentId, entry)
        if (merged) {
          childChanged = true
          return { ...child, segments: merged }
        }
        return child
      })
      if (childChanged) {
        changed = true
        return { ...seg, children: newChildren }
      }
    }
    return seg
  })
  return changed ? next : null
}

export function reduceStreamMessage(
  state: MessageState,
  ev: StreamMessageEvent,
): MessageState {
  const body = ev.body as Record<string, unknown> | null
  if (!body) return state
  const content = body.content
  const parentToolUseId = ev.parent_tool_use_id ?? null

  // Subagent messages — route into the parent Agent/Task tool_use's
  // `children` instead of starting a new pair. We hide user-role messages
  // that exist purely to carry tool_result echoes between subagent turns
  // (the result already shows up under the inner tool_use).
  if (parentToolUseId) {
    if (!state.currentId) return state
    const idx = state.pairs.findIndex((p) => p.id === state.currentId)
    if (idx === -1) return state
    let entrySegments: AssistantSegment[]
    if (ev.kind === 'user') {
      const classified = classifyUserContent(content)
      if (classified.kind === 'tool_result_only') {
        entrySegments = userToolResultsFromContent(content)
      } else if (classified.text) {
        entrySegments = [{ kind: 'text', text: classified.text }]
      } else {
        return state
      }
    } else {
      entrySegments = assistantSegmentsFrom(content)
    }
    if (entrySegments.length === 0) return state
    const entry: SubagentEntry = { role: ev.kind, segments: entrySegments }
    const merged = appendToSubagent(
      state.pairs[idx].segments,
      parentToolUseId,
      entry,
    )
    if (!merged) return state
    const next = state.pairs.slice()
    next[idx] = { ...state.pairs[idx], segments: merged }
    return { pairs: next, currentId: state.currentId }
  }

  if (ev.kind === 'user') {
    const classified = classifyUserContent(content)
    if (classified.kind === 'tool_result_only') {
      const results = userToolResultsFromContent(content)
      if (results.length === 0 || !state.currentId) return state
      const idx = state.pairs.findIndex((p) => p.id === state.currentId)
      if (idx === -1) return state
      const updated: QaPair = {
        ...state.pairs[idx],
        segments: [...state.pairs[idx].segments, ...results],
      }
      const next = state.pairs.slice()
      next[idx] = updated
      return { pairs: next, currentId: state.currentId }
    }
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
  // When --include-partial-messages is on, the same thinking/text content
  // already arrived as `stream_event` deltas and lives at the tail of the
  // segment list. The aggregated `assistant` message we're processing now
  // would otherwise duplicate it.
  //
  // Strategy:
  //   1. Drop trailing `partial: true` (in-flight) blocks — content_block_stop
  //      may have been missed.
  //   2. If the tail is a streamed thinking/text (partial defined), the
  //      message's text/thinking blocks are redundant — keep only tool_use
  //      / image / plan / redacted_thinking from the full message.
  //   3. Otherwise (legacy path, partial-messages off), append every block.
  const baseSegments = dropTrailingLivePartials(state.pairs[idx].segments)
  const useStreamed = lastSegmentWasStreamed(baseSegments)
  const filtered = useStreamed
    ? segs.filter((s) => s.kind !== 'thinking' && s.kind !== 'text')
    : segs
  if (filtered.length === 0 && baseSegments === state.pairs[idx].segments) {
    return state
  }
  const updated: QaPair = {
    ...state.pairs[idx],
    segments: [...baseSegments, ...filtered],
  }
  const next = state.pairs.slice()
  next[idx] = updated
  return { pairs: next, currentId: state.currentId }
}

function dropTrailingLivePartials(
  segments: AssistantSegment[],
): AssistantSegment[] {
  let end = segments.length
  while (end > 0) {
    const s = segments[end - 1]
    if ((s.kind === 'thinking' || s.kind === 'text') && s.partial === true) {
      end -= 1
    } else {
      break
    }
  }
  return end === segments.length ? segments : segments.slice(0, end)
}

function lastSegmentWasStreamed(segments: AssistantSegment[]): boolean {
  const s = segments[segments.length - 1]
  if (!s) return false
  return (
    (s.kind === 'thinking' || s.kind === 'text') && s.partial !== undefined
  )
}

/**
 * Apply one Anthropic SSE delta to the current pair. We treat the in-flight
 * pair's segment tail as the "live" zone: thinking_delta accumulates into a
 * trailing partial-thinking segment, text_delta into a trailing partial-text
 * segment. content_block_stop flips `partial: false` and records duration_ms
 * for thinking so the UI can render "Thought for Ns".
 */
export function reduceStreamPartial(
  state: MessageState,
  ev: StreamPartialEvent,
  now: number = Date.now(),
): MessageState {
  if (ev.parent_tool_use_id) {
    // Subagent stream deltas: skip for now — we render subagent inner
    // activity from the aggregated assistant message (which still arrives).
    // Wiring partial assembly into the nested tree is doable but adds a
    // lot of complexity for marginal UX gain; revisit if needed.
    return state
  }
  if (!state.currentId) return state
  const evt = ev.event as Record<string, unknown> | null
  if (!evt) return state
  const type = evt.type
  const idx = state.pairs.findIndex((p) => p.id === state.currentId)
  if (idx === -1) return state
  const pair = state.pairs[idx]
  const segments = pair.segments

  const replacePair = (newSegments: AssistantSegment[]): MessageState => {
    const next = state.pairs.slice()
    next[idx] = { ...pair, segments: newSegments }
    return { pairs: next, currentId: state.currentId }
  }

  if (type === 'content_block_start') {
    const block = evt.content_block as Record<string, unknown> | undefined
    const bt = block?.type
    if (bt === 'thinking') {
      return replacePair([
        ...segments,
        {
          kind: 'thinking',
          text: typeof block?.thinking === 'string' ? (block.thinking as string) : '',
          partial: true,
          duration_ms: now, // store start timestamp; converted to elapsed at stop.
        },
      ])
    }
    if (bt === 'text') {
      return replacePair([
        ...segments,
        {
          kind: 'text',
          text: typeof block?.text === 'string' ? (block.text as string) : '',
          partial: true,
        },
      ])
    }
    // tool_use / image / etc. content_block_start: ignore — the aggregated
    // `assistant` message will carry the full block including parsed input.
    return state
  }

  if (type === 'content_block_delta') {
    const delta = evt.delta as Record<string, unknown> | undefined
    const dt = delta?.type
    const tail = segments[segments.length - 1]
    if (!tail) return state
    if (dt === 'thinking_delta' && tail.kind === 'thinking' && tail.partial) {
      const add = typeof delta?.thinking === 'string' ? (delta.thinking as string) : ''
      if (!add) return state
      return replacePair([
        ...segments.slice(0, -1),
        { ...tail, text: tail.text + add },
      ])
    }
    if (dt === 'text_delta' && tail.kind === 'text' && tail.partial) {
      const add = typeof delta?.text === 'string' ? (delta.text as string) : ''
      if (!add) return state
      return replacePair([
        ...segments.slice(0, -1),
        { ...tail, text: tail.text + add },
      ])
    }
    // signature_delta / input_json_delta / citations_delta — surface via the
    // aggregated message instead.
    return state
  }

  if (type === 'content_block_stop') {
    const tail = segments[segments.length - 1]
    if (!tail) return state
    if (tail.kind === 'thinking' && tail.partial) {
      // duration_ms currently holds the start timestamp; convert to elapsed.
      const elapsed =
        typeof tail.duration_ms === 'number' ? now - tail.duration_ms : undefined
      return replacePair([
        ...segments.slice(0, -1),
        { ...tail, partial: false, duration_ms: elapsed },
      ])
    }
    if (tail.kind === 'text' && tail.partial) {
      return replacePair([
        ...segments.slice(0, -1),
        { ...tail, partial: false },
      ])
    }
    return state
  }

  // message_start / message_delta / message_stop — nothing to render.
  return state
}

/**
 * Attach a tool_progress heartbeat to the matching tool_use segment so the
 * UI can show a "running… 3s" badge.
 */
export function reduceToolProgress(
  state: MessageState,
  payload: ToolProgressPayload,
): MessageState {
  if (!state.currentId || !payload.tool_use_id) return state
  const idx = state.pairs.findIndex((p) => p.id === state.currentId)
  if (idx === -1) return state
  const pair = state.pairs[idx]
  const entry: ToolProgressEntry = {
    phase: payload.phase,
    elapsed_seconds: payload.elapsed_time_seconds,
    last_tool_name: payload.last_tool_name,
  }
  let changed = false
  const newSegments = pair.segments.map((seg) => {
    if (seg.kind !== 'tool_use' || seg.id !== payload.tool_use_id) return seg
    changed = true
    return { ...seg, progress: [...(seg.progress ?? []), entry] }
  })
  if (!changed) return state
  const next = state.pairs.slice()
  next[idx] = { ...pair, segments: newSegments }
  return { pairs: next, currentId: state.currentId }
}

export function makeInitialMessageState(pairs: QaPair[]): MessageState {
  return {
    pairs,
    currentId: pairs.length > 0 ? pairs[pairs.length - 1].id : null,
  }
}
