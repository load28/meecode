/**
 * Module-level session store.
 *
 * Why a store and not a hook-managed listener:
 * - Tauri's `listen()` is async (round-trips through IPC). When listeners
 *   are registered inside a component's `useEffect`, StrictMode's
 *   mount → cleanup → mount cycle can fire `cleanup` before the
 *   `listen()` promise resolves, leaving a small window during which the
 *   backend emits events that no handler receives.
 * - The race only repeats on every key change (epoch bump on session
 *   switch), so it shows up exactly on the action we care about.
 *
 * The store registers listeners **once** at module load and never tears
 * them down. React components subscribe to per-tab snapshots via
 * `useSyncExternalStore` and never touch the listener lifecycle.
 */
import { listen } from '@tauri-apps/api/event'
import type { Mode, QaPair, SlashCommand, ToolRequest } from '../types'
import {
  makeInitialMessageState,
  reduceStreamMessage,
  reduceStreamPartial,
  reduceToolProgress,
  type StreamMessageEvent,
  type StreamPartialEvent,
  type ToolProgressPayload,
} from '../hooks/reduceStreamMessage'
import { tabIdOf } from '../utils/tabId'

export interface UsageStats {
  totalCostUsd: number
  totalDurationMs: number
  turnCount: number
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheCreationTokens: number
}

export interface McpServerInfo {
  name: string
  status?: string
}

export interface AgentInfo {
  name: string
  description?: string
}

export interface QueuedMessage {
  id: string
  text: string
  images?: Array<{ media_type: string; data: string }>
}

/**
 * Latest background-task heartbeat. `status:requesting` is fired between
 * API round-trips; `task_*` for background Agents/Bash. Cleared on turn_end.
 */
export interface TaskActivity {
  subtype: string
  task_id?: string
  description?: string
  last_tool_name?: string
  tool_use_id?: string
}

export interface TabSession {
  pairs: QaPair[]
  currentId: string | null
  pendingTool: ToolRequest | null
  mode: Mode
  hookActivity: string | null
  taskActivity: TaskActivity | null
  rateLimit: string | null
  turnError: string | null
  turnInProgress: boolean
  slashCommands: SlashCommand[]
  model: string | null
  usage: UsageStats
  sessionId: string | null
  cwd: string | null
  mcpServers: McpServerInfo[]
  agents: AgentInfo[]
  tools: string[]
  queue: QueuedMessage[]
}

export function initialTabSession(): TabSession {
  return {
    pairs: [],
    currentId: null,
    pendingTool: null,
    mode: 'default',
    hookActivity: null,
    taskActivity: null,
    rateLimit: null,
    turnError: null,
    turnInProgress: false,
    slashCommands: [],
    model: null,
    usage: {
      totalCostUsd: 0,
      totalDurationMs: 0,
      turnCount: 0,
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheCreationTokens: 0,
    },
    sessionId: null,
    cwd: null,
    mcpServers: [],
    agents: [],
    tools: [],
    queue: [],
  }
}

// State + subscribers, keyed by tab id.
const state = new Map<string, TabSession>()
const subscribers = new Map<string, Set<() => void>>()

function getOrCreate(tabId: string): TabSession {
  let t = state.get(tabId)
  if (!t) {
    t = initialTabSession()
    state.set(tabId, t)
  }
  return t
}

function notify(tabId: string) {
  const subs = subscribers.get(tabId)
  if (!subs) return
  for (const cb of subs) cb()
}

export function getTabSnapshot(tabId: string): TabSession {
  return getOrCreate(tabId)
}

export function subscribeTab(tabId: string, cb: () => void): () => void {
  let subs = subscribers.get(tabId)
  if (!subs) {
    subs = new Set()
    subscribers.set(tabId, subs)
  }
  subs.add(cb)
  return () => {
    subs!.delete(cb)
  }
}

export function setTab(
  tabId: string,
  updater: (prev: TabSession) => TabSession,
): void {
  const prev = getOrCreate(tabId)
  const next = updater(prev)
  if (next === prev) return
  state.set(tabId, next)
  notify(tabId)
}

function modeFromClaude(s: string | undefined | null): Mode | null {
  if (!s) return null
  switch (s) {
    case 'default':
      return 'default'
    case 'plan':
      return 'plan'
    case 'auto':
    case 'acceptEdits':
      return 'auto-accept'
    default:
      return null
  }
}

// --- Tauri listener bootstrap, runs exactly once per page load. ---

let bootstrapped = false

export function bootstrapSessionListeners(): void {
  if (bootstrapped) return
  bootstrapped = true
  console.log('[sessionStore] bootstrapping listeners (once per page load)')

  listen<{ tab_id: string; pairs: QaPair[] }>('session:history', (e) => {
    const tab = tabIdOf(e.payload)
    console.log('[sessionStore] session:history', tab, e.payload.pairs?.length)
    setTab(tab, (s) => {
      const init = makeInitialMessageState(e.payload.pairs ?? [])
      return { ...s, pairs: init.pairs, currentId: init.currentId }
    })
  })

  listen<StreamMessageEvent & { tab_id?: string }>(
    'session:message',
    (e) => {
      const tab = tabIdOf(e.payload)
      setTab(tab, (s) => {
        const next = reduceStreamMessage(
          { pairs: s.pairs, currentId: s.currentId },
          e.payload,
        )
        // Any assistant/user message arrival means the agent is still
        // emitting work — flip `turnInProgress` back on. Claude CLI emits
        // intermediate `result` lines between tool roundtrips (each one
        // hits the `session:turn_end` handler and clears the flag), so
        // without this the StatusIndicator vanishes mid-conversation while
        // the agent is still calling MCP/WebSearch tools.
        return {
          ...s,
          pairs: next.pairs,
          currentId: next.currentId,
          turnInProgress: true,
        }
      })
    },
  )

  // Anthropic SSE deltas (--include-partial-messages). These drive
  // token-by-token thinking/text rendering. The aggregated `assistant`
  // message arriving afterwards replaces these partials.
  listen<StreamPartialEvent & { tab_id?: string }>(
    'session:stream_event',
    (e) => {
      const tab = tabIdOf(e.payload)
      setTab(tab, (s) => {
        const next = reduceStreamPartial(
          { pairs: s.pairs, currentId: s.currentId },
          e.payload,
        )
        // Live SSE delta → agent is actively producing tokens; mark busy
        // for the same reason as `session:message` above.
        return {
          ...s,
          pairs: next.pairs,
          currentId: next.currentId,
          turnInProgress: true,
        }
      })
    },
  )

  // Long-running-tool heartbeats. Attached to the matching tool_use segment
  // so the UI can render a "running 3s" badge.
  listen<ToolProgressPayload & { tab_id?: string }>(
    'session:tool_progress',
    (e) => {
      const tab = tabIdOf(e.payload)
      setTab(tab, (s) => {
        const next = reduceToolProgress(
          { pairs: s.pairs, currentId: s.currentId },
          e.payload,
        )
        return { ...s, pairs: next.pairs, currentId: next.currentId }
      })
    },
  )

  // system:task_started/task_progress/task_notification — for background
  // agents and long Bash. Surface as a single transient banner.
  listen<{
    tab_id?: string
    subtype: string
    task_id?: string
    description?: string
    last_tool_name?: string
    tool_use_id?: string
    status?: string
  }>('session:task_activity', (e) => {
    const tab = tabIdOf(e.payload)
    const p = e.payload
    setTab(tab, (s) => {
      if (p.subtype === 'task_notification' && p.status !== 'in_progress') {
        // Terminal status — clear the banner.
        return { ...s, taskActivity: null }
      }
      return {
        ...s,
        taskActivity: {
          subtype: p.subtype,
          task_id: p.task_id,
          description: p.description,
          last_tool_name: p.last_tool_name,
          tool_use_id: p.tool_use_id,
        },
      }
    })
  })

  listen<ToolRequest & { tab_id?: string }>('session:tool_request', (e) => {
    const tab = tabIdOf(e.payload)
    setTab(tab, (s) => ({ ...s, pendingTool: e.payload }))
  })

  listen<{ tab_id: string; line: string }>('session:stderr', (e) => {
    console.warn('[claude stderr]', e.payload.line)
  })

  listen<{ tab_id: string }>('session:exit', (e) => {
    const tab = tabIdOf(e.payload)
    setTab(tab, (s) => ({
      ...s,
      turnInProgress: false,
      hookActivity: null,
      turnError: s.turnError ?? 'session ended',
    }))
  })

  listen<{ tab_id?: string; hook_name: string; phase: string }>(
    'session:hook',
    (e) => {
      const tab = tabIdOf(e.payload)
      const label =
        e.payload.phase === 'hook_response'
          ? null
          : `${e.payload.hook_name} 훅 실행 중…`
      setTab(tab, (s) => ({ ...s, hookActivity: label }))
    },
  )

  listen<Record<string, unknown>>('session:rate_limit', (e) => {
    const tab = tabIdOf(e.payload)
    const p = e.payload
    const explicit =
      (typeof p.message === 'string' && p.message) ||
      (typeof p.reason === 'string' && p.reason) ||
      (typeof p.error === 'string' && p.error) ||
      null
    if (!explicit) return
    setTab(tab, (s) => ({ ...s, rateLimit: explicit }))
  })

  listen<{ tab_id?: string }>('session:control_cancel', (e) => {
    const tab = tabIdOf(e.payload)
    setTab(tab, (s) => ({ ...s, pendingTool: null }))
  })

  listen<{ tab_id?: string }>('session:compact', (e) => {
    const tab = tabIdOf(e.payload)
    setTab(tab, (s) => ({
      ...s,
      pairs: [
        ...s.pairs,
        {
          id: `compact-${Date.now()}`,
          user_text: '── 이전 대화가 자동 압축됨 ──',
          segments: [],
          timestamp: new Date().toISOString(),
        },
      ],
      currentId: null,
    }))
  })

  listen<{
    tab_id?: string
    session_id?: string
    slash_commands?: Array<{ name?: string; description?: string } | string>
    model?: string
    permission_mode?: string
    cwd?: string
    mcp_servers?: Array<{ name?: string; status?: string }>
    agents?: Array<{ name?: string; description?: string } | string>
    tools?: Array<string | { name?: string }>
  }>('session:init', (e) => {
    const tab = tabIdOf(e.payload)
    const payload = e.payload
    const cmds: SlashCommand[] = (payload.slash_commands ?? [])
      .map((c) =>
        typeof c === 'string'
          ? { name: c }
          : { name: c.name ?? '', description: c.description },
      )
      .filter((c) => c.name.length > 0)
    const claudeMode = modeFromClaude(payload.permission_mode)
    const servers: McpServerInfo[] = (payload.mcp_servers ?? [])
      .filter((m): m is { name: string; status?: string } =>
        typeof m.name === 'string' && m.name.length > 0,
      )
      .map((m) => ({ name: m.name, status: m.status }))
    const agents: AgentInfo[] = (payload.agents ?? [])
      .map((a) =>
        typeof a === 'string'
          ? { name: a }
          : { name: a.name ?? '', description: a.description },
      )
      .filter((a) => a.name)
    const tools: string[] = (payload.tools ?? [])
      .map((t) => (typeof t === 'string' ? t : t.name ?? ''))
      .filter((t) => t)
    setTab(tab, (s) => ({
      ...s,
      slashCommands: cmds.length ? cmds : s.slashCommands,
      model: payload.model ?? s.model,
      mode: claudeMode ?? s.mode,
      sessionId: payload.session_id ?? s.sessionId,
      cwd: payload.cwd ?? s.cwd,
      mcpServers: servers.length ? servers : s.mcpServers,
      agents: agents.length ? agents : s.agents,
      tools: tools.length ? tools : s.tools,
      turnInProgress: false,
      hookActivity: null,
      taskActivity: null,
    }))
  })

  listen<{
    tab_id?: string
    subtype?: string
    rest?: {
      total_cost_usd?: number
      duration_ms?: number
      is_error?: boolean
      result?: string
      usage?: {
        input_tokens?: number
        output_tokens?: number
        cache_read_input_tokens?: number
        cache_creation_input_tokens?: number
      }
    }
  }>('session:turn_end', (e) => {
    const tab = tabIdOf(e.payload)
    const r = e.payload.rest ?? {}
    const sub = e.payload.subtype
    const errLabel =
      sub && sub !== 'success'
        ? sub.replace(/_/g, ' ')
        : r.is_error
        ? typeof r.result === 'string'
          ? r.result
          : 'turn ended with error'
        : null
    setTab(tab, (s) => ({
      ...s,
      turnError: errLabel,
      turnInProgress: false,
      hookActivity: null,
      taskActivity: null,
      usage: {
        totalCostUsd:
          s.usage.totalCostUsd +
          (typeof r.total_cost_usd === 'number' ? r.total_cost_usd : 0),
        totalDurationMs:
          s.usage.totalDurationMs +
          (typeof r.duration_ms === 'number' ? r.duration_ms : 0),
        turnCount: s.usage.turnCount + 1,
        inputTokens: s.usage.inputTokens + (r.usage?.input_tokens ?? 0),
        outputTokens: s.usage.outputTokens + (r.usage?.output_tokens ?? 0),
        cacheReadTokens:
          s.usage.cacheReadTokens + (r.usage?.cache_read_input_tokens ?? 0),
        cacheCreationTokens:
          s.usage.cacheCreationTokens +
          (r.usage?.cache_creation_input_tokens ?? 0),
      },
    }))
  })
}

// Reset a tab's local state without touching listeners. Use this when the
// frontend deliberately replaces a session (project switch, new session).
export function resetTab(tabId: string): void {
  setTab(tabId, () => initialTabSession())
}
