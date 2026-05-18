import { useEffect, useState } from 'react'
import { listen } from '@tauri-apps/api/event'

interface PtyStreamState {
  markdownContent: string
  isMarkdownVisible: boolean
}

export function usePtyStream(): PtyStreamState {
  const [state, setState] = useState<PtyStreamState>({
    markdownContent: '',
    isMarkdownVisible: false,
  })

  useEffect(() => {
    const unlistenMd = listen<string>('md:update', (event) => {
      setState({
        markdownContent: event.payload,
        isMarkdownVisible: true,
      })
    })

    return () => {
      unlistenMd.then((fn) => fn())
    }
  }, [])

  return state
}
