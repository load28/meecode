import { useEffect, useState } from 'react'
import { listen } from '@tauri-apps/api/event'
import type { QaPair } from '../types'

interface Result {
  pairs: QaPair[]
}

export function usePtyStream(): Result {
  const [pairs, setPairs] = useState<QaPair[]>([])

  useEffect(() => {
    const unlistenPromise = listen<QaPair[]>('session:update', (event) => {
      setPairs(event.payload)
    })
    return () => {
      unlistenPromise.then((fn) => fn())
    }
  }, [])

  return { pairs }
}
