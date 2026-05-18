import { useCallback, useEffect, useState } from 'react'
import { listen } from '@tauri-apps/api/event'
import { invoke } from '@tauri-apps/api/core'
import type { Mode, QaPair, ToolRequest } from '../types'
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
}

export interface UseClaudeSessionResult {
  pairs: QaPair[]
  pendingTool: ToolRequest | null
  mode: Mode
  sendUserMessage: (text: string) => Promise<void>
  respondTool: (
    requestId: string,
    allow: boolean,
    toolUseId: string | null,
    updatedInput?: unknown,
  ) => Promise<void>
  cycleMode: () => void
}

const MODE_CYCLE: Mode[] = ['default', 'plan', 'auto-accept']

export function useClaudeSession(): UseClaudeSessionResult {
  const [state, setState] = useState<SessionState>({
    pairs: [],
    currentId: null,
    pendingTool: null,
    mode: 'default',
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

  return {
    pairs: state.pairs,
    pendingTool: state.pendingTool,
    mode: state.mode,
    sendUserMessage,
    respondTool,
    cycleMode,
  }
}
