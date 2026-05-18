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
    const unlistens: Array<Promise<() => void>> = []

    unlistens.push(
      listen<QaPair[]>('session:history', (e) =>
        setState((s) => {
          const init = makeInitialMessageState(e.payload)
          return { ...s, pairs: init.pairs, currentId: init.currentId }
        }),
      ),
    )

    unlistens.push(
      listen<StreamMessageEvent>('session:message', (e) =>
        setState((s) => {
          const next = reduceStreamMessage(
            { pairs: s.pairs, currentId: s.currentId },
            e.payload,
          )
          return { ...s, pairs: next.pairs, currentId: next.currentId }
        }),
      ),
    )

    unlistens.push(
      listen<ToolRequest>('session:tool_request', (e) =>
        setState((s) => ({ ...s, pendingTool: e.payload })),
      ),
    )

    return () => {
      unlistens.forEach((p) => p.then((fn) => fn()))
    }
  }, [])

  const sendUserMessage = useCallback(async (text: string) => {
    await invoke('send_user_message', { text })
  }, [])

  const respondTool = useCallback(
    async (requestId: string, allow: boolean, toolUseId: string | null) => {
      await invoke('send_tool_response', {
        args: { request_id: requestId, allow, tool_use_id: toolUseId },
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
