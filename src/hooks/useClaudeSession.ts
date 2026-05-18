import { useCallback, useEffect, useState } from 'react'
import { listen } from '@tauri-apps/api/event'
import { invoke } from '@tauri-apps/api/core'
import type { Mode, QaPair, ToolRequest } from '../types'

interface SessionState {
  pairs: QaPair[]
  pendingTool: ToolRequest | null
  mode: Mode
}

export interface UseClaudeSessionResult extends SessionState {
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
    pendingTool: null,
    mode: 'default',
  })

  useEffect(() => {
    const unlistens: Array<Promise<() => void>> = []

    unlistens.push(
      listen<QaPair[]>('session:history', (e) =>
        setState((s) => ({ ...s, pairs: e.payload })),
      ),
    )

    unlistens.push(
      listen<QaPair>('session:message', (e) =>
        setState((s) => {
          const incoming = e.payload
          const idx = s.pairs.findIndex((p) => p.id === incoming.id)
          if (idx === -1) return { ...s, pairs: [...s.pairs, incoming] }
          const next = s.pairs.slice()
          next[idx] = incoming
          return { ...s, pairs: next }
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

  return { ...state, sendUserMessage, respondTool, cycleMode }
}
