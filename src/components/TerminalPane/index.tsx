import { useEffect, useRef } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { listen } from '@tauri-apps/api/event'
import { invoke } from '@tauri-apps/api/core'
import '@xterm/xterm/css/xterm.css'
import './TerminalPane.css'

const KEY_MAP: Record<string, string> = {
  Enter: '\r',
  Backspace: '\x7f',
  Tab: '\t',
  Escape: '\x1b',
  ArrowUp: '\x1b[A',
  ArrowDown: '\x1b[B',
  ArrowRight: '\x1b[C',
  ArrowLeft: '\x1b[D',
  Home: '\x1b[H',
  End: '\x1b[F',
  PageUp: '\x1b[5~',
  PageDown: '\x1b[6~',
  Delete: '\x1b[3~',
}

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

    const textarea = containerRef.current.querySelector<HTMLTextAreaElement>(
      '.xterm-helper-textarea'
    )

    const send = (text: string) => {
      invoke('write_input', { text }).catch(console.error)
    }

    let isComposing = false

    const onCompositionStart = () => {
      isComposing = true
    }
    const onCompositionEnd = (e: CompositionEvent) => {
      isComposing = false
      if (e.data) send(e.data)
      if (textarea) textarea.value = ''
    }
    const onInput = (e: Event) => {
      const evt = e as InputEvent
      if (isComposing || evt.isComposing) return
      if (evt.inputType === 'insertCompositionText') return
      if (evt.data) send(evt.data)
      if (textarea) textarea.value = ''
      e.stopImmediatePropagation()
    }
    const onKeyDown = (e: KeyboardEvent) => {
      if (isComposing || e.isComposing || e.keyCode === 229) {
        e.stopImmediatePropagation()
        return
      }
      const mapped = KEY_MAP[e.key]
      if (mapped) {
        e.preventDefault()
        e.stopImmediatePropagation()
        send(mapped)
        return
      }
      if (e.ctrlKey && e.key.length === 1) {
        const code = e.key.toLowerCase().charCodeAt(0) - 96
        if (code >= 1 && code <= 26) {
          e.preventDefault()
          e.stopImmediatePropagation()
          send(String.fromCharCode(code))
          return
        }
      }
      if (e.metaKey || e.altKey) return
      if (e.key.length === 1) {
        const code = e.key.charCodeAt(0)
        if (code < 128) {
          e.preventDefault()
          e.stopImmediatePropagation()
          send(e.key)
        }
      }
    }

    textarea?.addEventListener('compositionstart', onCompositionStart, true)
    textarea?.addEventListener('compositionend', onCompositionEnd, true)
    textarea?.addEventListener('input', onInput, true)
    textarea?.addEventListener('keydown', onKeyDown, true)

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
      textarea?.removeEventListener('input', onInput, true)
      textarea?.removeEventListener('keydown', onKeyDown, true)
      resizeObserver.disconnect()
      unlistenPty.then((fn) => fn())
      term.dispose()
    }
  }, [])

  return <div ref={containerRef} className="terminal-container" />
}
