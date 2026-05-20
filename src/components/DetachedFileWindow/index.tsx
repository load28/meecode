import { useEffect, useRef, useState } from 'react'
import { emitTo, listen } from '@tauri-apps/api/event'
import { getCurrentWebviewWindow } from '@tauri-apps/api/webviewWindow'
import { useFileTabs, type OpenOptions } from '../../hooks/useFileTabs'
import { FilePanel } from '../FilePanel'
import './DetachedFileWindow.css'

interface InitPayload {
  paths: string[]
  activePath: string | null
}

interface OpenPayload {
  path: string
  opts?: OpenOptions
}

interface SnippetPayload {
  text: string
  path: string
  startLine: number
  endLine: number
}

const MAIN_LABEL = 'main'

export function DetachedFileWindow() {
  const fileTabs = useFileTabs()
  const [hydrated, setHydrated] = useState(false)

  // Close handler needs the latest tabs/active to send back. The hook
  // re-renders on every change, so a ref kept in sync survives the closure
  // captured by onCloseRequested.
  const fileTabsRef = useRef(fileTabs)
  fileTabsRef.current = fileTabs

  useEffect(() => {
    let mounted = true
    const cleanups: Array<() => void> = []

    void (async () => {
      const initUnlisten = await listen<InitPayload>('file:init', (e) => {
        if (!mounted) return
        const { paths, activePath } = e.payload
        paths.forEach((p) => void fileTabsRef.current.open(p))
        if (activePath) fileTabsRef.current.setActive(activePath)
        setHydrated(true)
      })
      cleanups.push(initUnlisten)

      const openUnlisten = await listen<OpenPayload>('file:open', (e) => {
        if (!mounted) return
        void fileTabsRef.current.open(e.payload.path, e.payload.opts)
      })
      cleanups.push(openUnlisten)

      const w = getCurrentWebviewWindow()
      const closeUnlisten = await w.onCloseRequested(async (event) => {
        // Convert "close window" into "dock back" — never actually destroy
        // the window without first handing tabs state back to main.
        event.preventDefault()
        const snapshot = fileTabsRef.current.tabs.map((t) => t.path)
        const active = fileTabsRef.current.activePath
        await emitTo(MAIN_LABEL, 'file:dock', {
          paths: snapshot,
          activePath: active,
        })
        await w.destroy()
      })
      cleanups.push(closeUnlisten)

      // Tell main we're ready to receive the initial payload. Main holds the
      // current tabs until this signal arrives so nothing is lost in transit.
      await emitTo(MAIN_LABEL, 'file:ready', {})
    })()

    return () => {
      mounted = false
      cleanups.forEach((u) => u())
    }
  }, [])

  const handleAddSnippet = (snippet: SnippetPayload) => {
    void emitTo(MAIN_LABEL, 'composer:add-context', snippet)
  }

  const handleDock = async () => {
    const w = getCurrentWebviewWindow()
    await w.close()
  }

  return (
    <div className="detached-file-window">
      {!hydrated && fileTabs.tabs.length === 0 && (
        <div className="detached-file-window__loading">불러오는 중…</div>
      )}
      <FilePanel
        tabs={fileTabs.tabs}
        activePath={fileTabs.activePath}
        onSelect={fileTabs.setActive}
        onClose={fileTabs.close}
        onCloseAll={fileTabs.closeAll}
        onSetViewMode={fileTabs.setViewMode}
        onSetMarkdownView={fileTabs.setMarkdownView}
        onAddSelectionToComposer={handleAddSnippet}
        onDock={handleDock}
      />
    </div>
  )
}

// Listen for unused payload type ref to keep TS happy if FilePanel's prop
// signature drifts. Intentionally exports nothing else.
export type { SnippetPayload as DetachedSnippet }
