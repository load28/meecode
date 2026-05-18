import { useCallback, useEffect, useState } from 'react'
import { listen } from '@tauri-apps/api/event'
import { invoke } from '@tauri-apps/api/core'
import type { Mode, QaPair, SlashCommand, ToolRequest } from '../types'
import {
  makeInitialMessageState,
  reduceStreamMessage,
  type StreamMessageEvent,
} from './reduceStreamMessage'

interface SessionState {
  pairs: QaPair[]
  currentId: string | null
  pendingTool: ToolRequest | null
  mode: Mode
  hookActivity: string | null
  rateLimit: string | null
  slashCommands: SlashCommand[]
  model: string | null
}

export interface UseClaudeSessionResult {
  pairs: QaPair[]
  pendingTool: ToolRequest | null
  mode: Mode
  hookActivity: string | null
  rateLimit: string | null
  slashCommands: SlashCommand[]
  model: string | null
  sendUserMessage: (text: string) => Promise<void>
  respondTool: (
    requestId: string,
    allow: boolean,
    toolUseId: string | null,
    updatedInput?: unknown,
  ) => Promise<void>
  cycleMode: () => void
  dismissRateLimit: () => void
  interrupt: () => Promise<void>
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
      listen<{
        session_id?: string
        slash_commands?: Array<{ name?: string; description?: string }>
        model?: string
      }>('session:init', (e) => {
        const cmds: SlashCommand[] = (e.payload.slash_commands ?? [])
          .filter((c): c is { name: string; description?: string } =>
            typeof c.name === 'string' && c.name.length > 0,
          )
          .map((c) => ({ name: c.name, description: c.description }))
        setState((s) => ({
          ...s,
          slashCommands: cmds.length ? cmds : s.slashCommands,
          model: e.payload.model ?? s.model,
        }))
      }),
    )

    return () => {
      unlistens.forEach((p) => p.then((fn) => fn()))
    }
  }, [])

  const sendUserMessage = useCallback(async (text: string) => {
    const localId = `local-${Date.now()}`
    setState((s) => ({
      ...s,
      pairs: [
        ...s.pairs,
        {
          id: localId,
          user_text: text,
          segments: [],
          timestamp: new Date().toISOString(),
        },
      ],
      currentId: localId,
    }))
    try {
      await invoke('send_user_message', { text })
    } catch (e) {
      console.error('[meecode] sendUserMessage invoke rejected', e)
      throw e
    }
  }, [])

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
      return { ...s, mode: next }
    })
  }, [])

  const dismissRateLimit = useCallback(() => {
    setState((s) => ({ ...s, rateLimit: null }))
  }, [])

  const interrupt = useCallback(async () => {
    await invoke('interrupt_session')
  }, [])

  return {
    pairs: state.pairs,
    pendingTool: state.pendingTool,
    mode: state.mode,
    hookActivity: state.hookActivity,
    rateLimit: state.rateLimit,
    slashCommands: state.slashCommands,
    model: state.model,
    sendUserMessage,
    respondTool,
    cycleMode,
    dismissRateLimit,
    interrupt,
  }
}
