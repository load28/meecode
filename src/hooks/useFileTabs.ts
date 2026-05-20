import { useCallback, useState } from 'react'
import { invoke } from '@tauri-apps/api/core'

export type PendingEditKind = 'edit' | 'write' | 'multiedit' | 'notebookedit'

export interface PendingEdit {
  /** Reconstructed "before" text — empty for `Write` since there's no prior. */
  oldText: string
  newText: string
  kind: PendingEditKind
  /** Optional label shown above the diff (e.g. "Edit 1/3"). */
  label?: string
}

export type FileViewMode = 'normal' | 'diff'

export interface FileTab {
  path: string
  content: string
  language: string
  size: number
  truncated: boolean
  loading: boolean
  error: string | null
  /** Pending Edit/Write payload; null for plain reads. */
  pending: PendingEdit | null
  viewMode: FileViewMode
}

interface BackendFile {
  path: string
  content: string
  language: string
  size: number
  truncated: boolean
}

export interface OpenOptions {
  pending?: PendingEdit | null
  /** Override view mode on open; defaults to 'diff' when pending is provided. */
  viewMode?: FileViewMode
}

export interface UseFileTabsResult {
  tabs: FileTab[]
  activePath: string | null
  open: (path: string, opts?: OpenOptions) => Promise<void>
  setActive: (path: string) => void
  setViewMode: (path: string, mode: FileViewMode) => void
  close: (path: string) => void
  closeAll: () => void
}

export function useFileTabs(): UseFileTabsResult {
  const [tabs, setTabs] = useState<FileTab[]>([])
  const [activePath, setActivePath] = useState<string | null>(null)

  const open = useCallback(async (path: string, opts: OpenOptions = {}) => {
    const { pending = null, viewMode } = opts
    const initialMode: FileViewMode = viewMode ?? (pending ? 'diff' : 'normal')

    setActivePath(path)
    setTabs((prev) => {
      const existing = prev.find((t) => t.path === path)
      if (existing) {
        // Re-opening a tab can refine its pending diff and switch the mode.
        // If no new pending is supplied, leave the existing one alone — a
        // plain re-click on the path shouldn't clobber a diff that was
        // already attached from an earlier Edit segment.
        return prev.map((t) =>
          t.path === path
            ? {
                ...t,
                pending: pending ?? t.pending,
                viewMode: viewMode ?? (pending ? 'diff' : t.viewMode),
              }
            : t,
        )
      }
      return [
        ...prev,
        {
          path,
          content: '',
          language: 'plaintext',
          size: 0,
          truncated: false,
          loading: true,
          error: null,
          pending,
          viewMode: initialMode,
        },
      ]
    })
    try {
      const r = await invoke<BackendFile>('read_file_text', { path })
      setTabs((prev) =>
        prev.map((t) =>
          t.path === path
            ? { ...t, ...r, loading: false, error: null }
            : t,
        ),
      )
    } catch (e) {
      setTabs((prev) =>
        prev.map((t) =>
          t.path === path ? { ...t, loading: false, error: String(e) } : t,
        ),
      )
    }
  }, [])

  const setActive = useCallback((path: string) => setActivePath(path), [])

  const setViewMode = useCallback((path: string, mode: FileViewMode) => {
    setTabs((prev) =>
      prev.map((t) => (t.path === path ? { ...t, viewMode: mode } : t)),
    )
  }, [])

  const close = useCallback(
    (path: string) => {
      setTabs((prev) => {
        const next = prev.filter((t) => t.path !== path)
        if (path === activePath) {
          setActivePath(next.length ? next[next.length - 1].path : null)
        }
        return next
      })
    },
    [activePath],
  )

  const closeAll = useCallback(() => {
    setTabs([])
    setActivePath(null)
  }, [])

  return { tabs, activePath, open, setActive, setViewMode, close, closeAll }
}
