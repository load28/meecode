import { useCallback } from 'react'
import type { ContentTab, OpenOptions, UseFileTabsResult } from './useFileTabs'

export interface UseDetachedFilePanelResult {
  isDetached: boolean
  detach: () => Promise<void>
  openFile: (path: string, opts?: OpenOptions) => void
  /** Open inline content (task source/wiki) in whichever panel owns the view. */
  openContent: (tab: ContentTab) => void
}

/**
 * Single-window file panel binding.
 *
 * The Tauri build detached the code panel into a *second webview* and synced it
 * over window events. On Electron the faithful replacement is a `window.open`
 * auxiliary window that shares the renderer (so there's one Monaco / store and
 * no cross-window sync) — see the M0.5 spike (electron/renderer) which proved
 * Monaco renders into such a child window. Until that lands, the panel stays
 * in-window: `detach` is a no-op and file/content opens route to the local tabs.
 */
export function useDetachedFilePanel(fileTabs: UseFileTabsResult): UseDetachedFilePanelResult {
  const detach = useCallback(async () => {
    // TODO(M3-detach): open a shared-renderer window.open aux window and portal
    // the FilePanel into it (VS Code auxiliaryWindowService). No-op for now.
    console.warn('[meecode] detach: window.open aux window not yet wired')
  }, [])

  const openFile = useCallback(
    (path: string, opts?: OpenOptions) => {
      void fileTabs.open(path, opts)
    },
    [fileTabs],
  )

  const openContent = useCallback(
    (tab: ContentTab) => {
      fileTabs.openContent(tab)
    },
    [fileTabs],
  )

  return { isDetached: false, detach, openFile, openContent }
}
