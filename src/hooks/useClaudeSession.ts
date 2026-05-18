import { useCallback, useEffect, useState } from 'react'
import { listen } from '@tauri-apps/api/event'
import { invoke } from '@tauri-apps/api/core'
import type { Mode, QaPair, SlashCommand, ToolRequest } from '../types'
import {
  makeInitialMessageState,
  reduceStreamMessage,
  type StreamMessageEvent,
} from './reduceStreamMessage'

interface UsageStats {
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

interface SessionState {
  pairs: QaPair[]
  currentId: string | null
  pendingTool: ToolRequest | null
  mode: Mode
  hookActivity: string | null
  rateLimit: string | null
  slashCommands: SlashCommand[]
  model: string | null
  usage: UsageStats
  sessionId: string | null
  cwd: string | null
  mcpServers: McpServerInfo[]
  agents: AgentInfo[]
  tools: string[]
}

export interface UseClaudeSessionResult {
  pairs: QaPair[]
  pendingTool: ToolRequest | null
  mode: Mode
  hookActivity: string | null
  rateLimit: string | null
  slashCommands: SlashCommand[]
  model: string | null
  usage: UsageStats
  sessionId: string | null
  cwd: string | null
  mcpServers: McpServerInfo[]
  agents: AgentInfo[]
  tools: string[]
  sendUserMessage: (
    text: string,
    images?: Array<{ media_type: string; data: string }>,
  ) => Promise<void>
  respondTool: (
    requestId: string,
    allow: boolean,
    toolUseId: string | null,
    updatedInput?: unknown,
  ) => Promise<void>
  cycleMode: () => void
  dismissRateLimit: () => void
  interrupt: () => Promise<void>
  setModel: (model: string | null) => Promise<void>
  setThinkingLevel: (level: string) => Promise<void>
  clearConversation: () => void
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

function modeToClaude(m: Mode): string {
  switch (m) {
    case 'default':
      return 'default'
    case 'plan':
      return 'plan'
    case 'auto-accept':
      return 'acceptEdits'
  }
}

const MODE_CYCLE: Mode[] = ['default', 'plan', 'auto-accept']

export function useClaudeSession(): UseClaudeSessionResult {
  const [state, setState] = useState<SessionState>({
    pairs: [],
    currentId: null,
    pendingTool: null,
    mode: 'default',
    hookActivity: null,
    rateLimit: null,
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
  })

  useEffect(() => {
    console.log('[meecode] useClaudeSession mount — wiring listeners')
    const unlistens: Array<Promise<() => void>> = []

    unlistens.push(
      listen<QaPair[]>('session:history', (e) => {
        console.log('[meecode] session:history', e.payload)
        setState((s) => {
          const init = makeInitialMessageState(e.payload)
          return { ...s, pairs: init.pairs, currentId: init.currentId }
        })
      }),
    )

    unlistens.push(
      listen<StreamMessageEvent>('session:message', (e) => {
        console.log('[meecode] session:message', e.payload)
        setState((s) => {
          const next = reduceStreamMessage(
            { pairs: s.pairs, currentId: s.currentId },
            e.payload,
          )
          return { ...s, pairs: next.pairs, currentId: next.currentId }
        })
      }),
    )

    unlistens.push(
      listen<ToolRequest>('session:tool_request', (e) => {
        console.log('[meecode] session:tool_request', e.payload)
        setState((s) => ({ ...s, pendingTool: e.payload }))
      }),
    )

    unlistens.push(
      listen<unknown>('session:turn_end', (e) =>
        console.log('[meecode] session:turn_end', e.payload),
      ),
    )

    unlistens.push(
      listen<{ session_id: string }>('session:start', (e) =>
        console.log('[meecode] session:start', e.payload),
      ),
    )

    unlistens.push(
      listen<string>('session:stderr', (e) =>
        console.warn('[claude stderr]', e.payload),
      ),
    )

    unlistens.push(
      listen<{ hook_name: string; phase: string }>('session:hook', (e) => {
        const label =
          e.payload.phase === 'hook_response'
            ? null
            : `${e.payload.hook_name} 훅 실행 중…`
        setState((s) => ({ ...s, hookActivity: label }))
      }),
    )

    unlistens.push(
      listen<Record<string, unknown>>('session:rate_limit', (e) => {
        const msg =
          (typeof e.payload.message === 'string' && e.payload.message) ||
          (typeof e.payload.reason === 'string' && e.payload.reason) ||
          'rate limit hit — 잠시 후 다시 시도하세요'
        setState((s) => ({ ...s, rateLimit: msg }))
      }),
    )

    unlistens.push(
      listen('session:control_cancel', () =>
        setState((s) => ({ ...s, pendingTool: null })),
      ),
    )

    unlistens.push(
      listen('session:compact', () =>
        setState((s) => ({
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
        })),
      ),
    )

    unlistens.push(
      listen<{
        session_id?: string
        slash_commands?: Array<{ name?: string; description?: string }>
        model?: string
        permission_mode?: string
        cwd?: string
        mcp_servers?: Array<{ name?: string; status?: string }>
        agents?: Array<{ name?: string; description?: string } | string>
        tools?: Array<string | { name?: string }>
      }>('session:init', (e) => {
        const cmds: SlashCommand[] = (e.payload.slash_commands ?? [])
          .filter((c): c is { name: string; description?: string } =>
            typeof c.name === 'string' && c.name.length > 0,
          )
          .map((c) => ({ name: c.name, description: c.description }))
        const claudeMode = modeFromClaude(e.payload.permission_mode)
        const servers: McpServerInfo[] = (e.payload.mcp_servers ?? [])
          .filter((m): m is { name: string; status?: string } =>
            typeof m.name === 'string' && m.name.length > 0,
          )
          .map((m) => ({ name: m.name, status: m.status }))
        const agents: AgentInfo[] = (e.payload.agents ?? [])
          .map((a) =>
            typeof a === 'string'
              ? { name: a }
              : { name: a.name ?? '', description: a.description },
          )
          .filter((a) => a.name)
        const tools: string[] = (e.payload.tools ?? [])
          .map((t) => (typeof t === 'string' ? t : t.name ?? ''))
          .filter((t) => t)
        setState((s) => ({
          ...s,
          slashCommands: cmds.length ? cmds : s.slashCommands,
          model: e.payload.model ?? s.model,
          mode: claudeMode ?? s.mode,
          sessionId: e.payload.session_id ?? s.sessionId,
          cwd: e.payload.cwd ?? s.cwd,
          mcpServers: servers.length ? servers : s.mcpServers,
          agents: agents.length ? agents : s.agents,
          tools: tools.length ? tools : s.tools,
        }))
      }),
    )

    unlistens.push(
      listen<{
        subtype?: string
        rest?: {
          total_cost_usd?: number
          duration_ms?: number
          usage?: {
            input_tokens?: number
            output_tokens?: number
            cache_read_input_tokens?: number
            cache_creation_input_tokens?: number
          }
        }
      }>('session:turn_end', (e) => {
        const r = e.payload.rest ?? {}
        setState((s) => ({
          ...s,
          usage: {
            totalCostUsd:
              s.usage.totalCostUsd + (typeof r.total_cost_usd === 'number' ? r.total_cost_usd : 0),
            totalDurationMs:
              s.usage.totalDurationMs + (typeof r.duration_ms === 'number' ? r.duration_ms : 0),
            turnCount: s.usage.turnCount + 1,
            inputTokens: s.usage.inputTokens + (r.usage?.input_tokens ?? 0),
            outputTokens: s.usage.outputTokens + (r.usage?.output_tokens ?? 0),
            cacheReadTokens:
              s.usage.cacheReadTokens + (r.usage?.cache_read_input_tokens ?? 0),
            cacheCreationTokens:
              s.usage.cacheCreationTokens + (r.usage?.cache_creation_input_tokens ?? 0),
          },
        }))
      }),
    )

    return () => {
      unlistens.forEach((p) => p.then((fn) => fn()))
    }
  }, [])

  const sendUserMessage = useCallback(
    async (
      text: string,
      images?: Array<{ media_type: string; data: string }>,
    ) => {
      const localId = `local-${Date.now()}`
      const imageSegments =
        images?.map((img) => ({
          kind: 'image' as const,
          media_type: img.media_type,
          data_url: `data:${img.media_type};base64,${img.data}`,
        })) ?? []
      setState((s) => ({
        ...s,
        pairs: [
          ...s.pairs,
          {
            id: localId,
            user_text: text || '',
            segments: imageSegments,
            timestamp: new Date().toISOString(),
          },
        ],
        currentId: localId,
      }))
      try {
        await invoke('send_user_message', { text, images })
      } catch (e) {
        console.error('[meecode] sendUserMessage invoke rejected', e)
        throw e
      }
    },
    [],
  )

  const respondTool = useCallback(
    async (
      requestId: string,
      allow: boolean,
      toolUseId: string | null,
      updatedInput?: unknown,
    ) => {
      await invoke('send_tool_response', {
        args: {
          request_id: requestId,
          allow,
          tool_use_id: toolUseId,
          updated_input: updatedInput ?? null,
        },
      })
      setState((s) => ({ ...s, pendingTool: null }))
    },
    [],
  )

  const cycleMode = useCallback(() => {
    setState((s) => {
      const next = MODE_CYCLE[(MODE_CYCLE.indexOf(s.mode) + 1) % MODE_CYCLE.length]
      invoke('set_permission_mode', { mode: modeToClaude(next) }).catch((e) =>
        console.warn('[meecode] set_permission_mode failed', e),
      )
      return { ...s, mode: next }
    })
  }, [])

  const dismissRateLimit = useCallback(() => {
    setState((s) => ({ ...s, rateLimit: null }))
  }, [])

  const interrupt = useCallback(async () => {
    await invoke('interrupt_session')
  }, [])

  const setModel = useCallback(async (model: string | null) => {
    await invoke('set_model', { model })
    setState((s) => ({ ...s, model: model ?? s.model }))
  }, [])

  const setThinkingLevel = useCallback(async (level: string) => {
    await invoke('set_thinking_level', { level })
  }, [])

  const clearConversation = useCallback(() => {
    setState((s) => ({ ...s, pairs: [], currentId: null }))
  }, [])

  return {
    pairs: state.pairs,
    pendingTool: state.pendingTool,
    mode: state.mode,
    hookActivity: state.hookActivity,
    rateLimit: state.rateLimit,
    slashCommands: state.slashCommands,
    model: state.model,
    usage: state.usage,
    sessionId: state.sessionId,
    cwd: state.cwd,
    mcpServers: state.mcpServers,
    agents: state.agents,
    tools: state.tools,
    sendUserMessage,
    respondTool,
    cycleMode,
    dismissRateLimit,
    interrupt,
    setModel,
    setThinkingLevel,
    clearConversation,
  }
}
