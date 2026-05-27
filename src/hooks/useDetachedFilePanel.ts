import { useCallback, useEffect, useRef, useState } from 'react'
import { openAuxiliaryWindow, type AuxiliaryWindow } from '../platform/auxiliaryWindow'
import type { ContentTab, OpenOptions, UseFileTabsResult } from './useFileTabs'

export interface UseDetachedFilePanelResult {
  isDetached: boolean
  detach: () => Promise<void>
  openFile: (path: string, opts?: OpenOptions) => void
  /** Open inline content (task source/wiki) in whichever panel owns the view. */
  openContent: (tab: ContentTab) => void
  /** When detached, the aux window mount point to portal the FilePanel into. */
  auxContainer: HTMLElement | null
}

/**
 * Detach the code panel into a `window.open` auxiliary window that shares this
 * renderer (VS Code's floating-editor model). Because the child window shares
 * the JS context, there's a single `fileTabs`, a single Monaco/model registry
 * and a single LSP client — so the consumer simply React-portals the *same*
 * `<FilePanel>` into `auxContainer` while detached. No document/state sync is
 * needed (that was the Tauri two-webview tax). Docking = closing the aux window;
 * the portal unmounts and the panel returns inline with its tabs/models intact.
 */
export function useDetachedFilePanel(fileTabs: UseFileTabsResult): UseDetachedFilePanelResult {
  const [aux, setAux] = useState<AuxiliaryWindow | null>(null)
  const auxRef = useRef<AuxiliaryWindow | null>(null)
  auxRef.current = aux

  const detach = useCallback(async () => {
    if (auxRef.current) {
      auxRef.current.window.focus()
      return
    }
    const a = openAuxiliaryWindow({
      title: 'Code — MeeCode',
      onClose: () => setAux(null),
    })
    if (!a) {
      console.warn('[meecode] detach: window.open blocked')
      return
    }
    setAux(a)
  }, [])

  // Tear the aux window down if this component unmounts.
  useEffect(() => () => auxRef.current?.close(), [])

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

  return {
    isDetached: !!aux,
    detach,
    openFile,
    openContent,
    auxContainer: aux?.container ?? null,
  }
}
