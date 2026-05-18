import { useEffect, useRef } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { listen } from '@tauri-apps/api/event'
import { invoke } from '@tauri-apps/api/core'
import '@xterm/xterm/css/xterm.css'
import './TerminalPane.css'

export function TerminalPane() {
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!containerRef.current) return

    const term = new Terminal({
      cursorBlink: true,
      fontSize: 14,
      fontFamily: 'Menlo, Monaco, "Courier New", monospace',
      theme: {
        background: '#0d1117',
        foreground: '#c9d1d9',
        cursor: '#58a6ff',
      },
    })

    const fitAddon = new FitAddon()
    term.loadAddon(fitAddon)
    term.open(containerRef.current)
    fitAddon.fit()
    invoke('resize_pty', { rows: term.rows, cols: term.cols }).catch(console.error)

    let isComposing = false

    term.onData((data) => {
      if (isComposing) return
      invoke('write_input', { text: data }).catch(console.error)
    })

    const textarea = containerRef.current.querySelector<HTMLTextAreaElement>(
      '.xterm-helper-textarea'
    )

    const onCompositionStart = () => {
      isComposing = true
    }
    const onCompositionEnd = (e: CompositionEvent) => {
      isComposing = false
      if (e.data) {
        invoke('write_input', { text: e.data }).catch(console.error)
      }
      if (textarea) textarea.value = ''
    }
    const blockDuringComposition = (e: Event) => {
      if (isComposing) {
        e.stopImmediatePropagation()
      }
    }

    textarea?.addEventListener('compositionstart', onCompositionStart, true)
    textarea?.addEventListener('compositionend', onCompositionEnd, true)
    textarea?.addEventListener('input', blockDuringComposition, true)
    textarea?.addEventListener('keydown', blockDuringComposition, true)
    textarea?.addEventListener('keypress', blockDuringComposition, true)

    const unlistenPty = listen<string>('pty:data', (event) => {
      term.write(event.payload)
    })

    const container = containerRef.current
    const resizeObserver = new ResizeObserver(() => {
      fitAddon.fit()
      invoke('resize_pty', { rows: term.rows, cols: term.cols }).catch(console.error)
    })
    resizeObserver.observe(container)

    return () => {
      textarea?.removeEventListener('compositionstart', onCompositionStart, true)
      textarea?.removeEventListener('compositionend', onCompositionEnd, true)
      textarea?.removeEventListener('input', blockDuringComposition, true)
      textarea?.removeEventListener('keydown', blockDuringComposition, true)
      textarea?.removeEventListener('keypress', blockDuringComposition, true)
      resizeObserver.disconnect()
      unlistenPty.then((fn) => fn())
      term.dispose()
    }
  }, [])

  return <div ref={containerRef} className="terminal-container" />
}
