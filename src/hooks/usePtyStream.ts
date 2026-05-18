import { useEffect, useState } from 'react'
import { listen } from '@tauri-apps/api/event'
import type { QaPair } from '../types'

interface SessionState {
  pairs: QaPair[]
  selectedId: string | null
  isVisible: boolean
}

interface Result extends SessionState {
  selectPair: (id: string) => void
}

export function usePtyStream(): Result {
  const [state, setState] = useState<SessionState>({
    pairs: [],
    selectedId: null,
    isVisible: false,
  })

  useEffect(() => {
    const unlisten = listen<QaPair[]>('session:update', (event) => {
      const pairs = event.payload
      setState((prev) => {
        const hasSelected = prev.selectedId && pairs.some((p) => p.id === prev.selectedId)
        const selectedId = hasSelected
          ? prev.selectedId
          : pairs.length > 0
            ? pairs[pairs.length - 1].id
            : null
        return {
          pairs,
          selectedId,
          isVisible: pairs.length > 0,
        }
      })
    })

    return () => {
      unlisten.then((fn) => fn())
    }
  }, [])

  const selectPair = (id: string) => {
    setState((prev) => ({ ...prev, selectedId: id }))
  }

  return { ...state, selectPair }
}
