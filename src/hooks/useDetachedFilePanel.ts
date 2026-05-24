import { useCallback, useEffect, useRef, useState } from 'react'
import { emitTo, listen } from '@tauri-apps/api/event'
import { WebviewWindow } from '@tauri-apps/api/webviewWindow'
import type { ContentTab, OpenOptions, UseFileTabsResult } from './useFileTabs'

const DETACHED_LABEL = 'file-panel'

interface DockPayload {
  paths: string[]
  contentTabs: ContentTab[]
  activePath: string | null
}

export interface UseDetachedFilePanelResult {
  isDetached: boolean
  detach: () => Promise<void>
  openFile: (path: string, opts?: OpenOptions) => void
  /** Open inline content (task source/wiki) in whichever panel owns the view. */
  openContent: (tab: ContentTab) => void
}

/** Split a tab list into real-file paths and inline content tabs. */
function snapshotTabs(tabs: UseFileTabsResult['tabs']): {
  paths: string[]
  contentTabs: ContentTab[]
} {
  const paths: string[] = []
  const contentTabs: ContentTab[] = []
  for (const t of tabs) {
    if (t.virtual) {
      contentTabs.push({
        key: t.path,
        title: t.title ?? t.path,
        content: t.content,
        language: t.language,
      })
    } else {
      paths.push(t.path)
    }
  }
  return { paths, contentTabs }
}

// Bridges main's local `useFileTabs` with an optional satellite window that
// owns the file viewer. Main and detached never both render the panel at
// the same time — ownership transfers on detach / dock, and intermediate
// `openFile` calls route to whichever side currently holds the panel.
export function useDetachedFilePanel(
  fileTabs: UseFileTabsResult,
): UseDetachedFilePanelResult {
  const [isDetached, setIsDetached] = useState(false)

  // Keep the latest fileTabs hook ref-accessible so async listeners
  // dispatched during detach setup don't capture a stale closure.
  const fileTabsRef = useRef(fileTabs)
  fileTabsRef.current = fileTabs

  const isDetachedRef = useRef(false)
  isDetachedRef.current = isDetached

  // Dock listener lives for the whole app lifetime: even after the detached
  // window's process is gone, this is what re-hydrates main with the tabs
  // that came back. Registering once avoids races where the detached window
  // emits `file:dock` before a per-detach listener wires up.
  useEffect(() => {
    let unlisten: (() => void) | null = null
    let mounted = true

    void listen<DockPayload>('file:dock', (e) => {
      const { paths, contentTabs, activePath } = e.payload
      const tabs = fileTabsRef.current
      tabs.closeAll()
      paths.forEach((p) => void tabs.open(p))
      ;(contentTabs ?? []).forEach((c) => tabs.openContent(c))
      if (activePath) tabs.setActive(activePath)
      setIsDetached(false)
    }).then((u) => {
      if (!mounted) {
        u()
        return
      }
      unlisten = u
    })

    return () => {
      mounted = false
      unlisten?.()
    }
  }, [])

  const detach = useCallback(async () => {
    if (isDetachedRef.current) return
    const { paths, contentTabs } = snapshotTabs(fileTabsRef.current.tabs)
    const active = fileTabsRef.current.activePath

    // The detached window emits `file:ready` once its listeners are wired.
    // Only after that do we send the init payload — otherwise the satellite
    // can miss tabs that were already open.
    let readyUnlisten: (() => void) | null = null
    readyUnlisten = await listen('file:ready', async () => {
      await emitTo(DETACHED_LABEL, 'file:init', {
        paths,
        contentTabs,
        activePath: active,
      })
      readyUnlisten?.()
      readyUnlisten = null
    })

    try {
      const w = new WebviewWindow(DETACHED_LABEL, {
        url: '?view=file-panel',
        title: 'Code — MeeCode',
        width: 900,
        height: 700,
        minWidth: 480,
        minHeight: 320,
      })

      w.once('tauri://error', (err) => {
        console.error('[detach] window create error', err)
        readyUnlisten?.()
        readyUnlisten = null
        setIsDetached(false)
      })
    } catch (err) {
      console.error('[detach] new WebviewWindow threw', err)
      readyUnlisten?.()
      return
    }

    // Hand ownership over: clear main's tabs immediately so the inline panel
    // collapses and chat reclaims the space. The detached window will repopulate
    // from the init payload we just queued up.
    fileTabsRef.current.closeAll()
    setIsDetached(true)
  }, [])

  const openFile = useCallback(
    (path: string, opts?: OpenOptions) => {
      if (isDetachedRef.current) {
        void emitTo(DETACHED_LABEL, 'file:open', { path, opts })
        return
      }
      void fileTabsRef.current.open(path, opts)
    },
    [],
  )

  const openContent = useCallback((tab: ContentTab) => {
    if (isDetachedRef.current) {
      void emitTo(DETACHED_LABEL, 'file:open-content', tab)
      return
    }
    fileTabsRef.current.openContent(tab)
  }, [])

  return { isDetached, detach, openFile, openContent }
}
