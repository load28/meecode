import { useCallback } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { peekTabState, useTabState } from '../state/tabViewStore'

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
export type MarkdownView = 'rendered' | 'source'

export interface FileTab {
  path: string
  content: string
  language: string
  size: number
  truncated: boolean
  /**
   * Disk modification time (epoch-ms) at last load/save. With `size` it forms
   * the editor's save-conflict "etag" — see useFileSave / write_file.
   */
  mtimeMs: number
  loading: boolean
  error: string | null
  /** Pending Edit/Write payload; null for plain reads. */
  pending: PendingEdit | null
  viewMode: FileViewMode
  /**
   * For markdown files only: rendered (default) shows formatted HTML,
   * source shows the raw `.md` text. Ignored for non-markdown files.
   */
  markdownView: MarkdownView
  /**
   * Friendly tab/header label. Falls back to the path's basename when
   * unset. Used by content tabs (task sources/wiki) so the synthetic
   * `path` key stays hidden behind a human label.
   */
  title?: string
  /**
   * Content tabs carry their body inline instead of reading from disk —
   * e.g. a captured Source or a task Wiki file. They never invoke the
   * filesystem and survive detach/dock by round-tripping their content.
   */
  virtual?: boolean
}

/** Inline content opened as a file tab — no disk read. */
export interface ContentTab {
  /** Stable key used as the tab's `path`. Should be unique per logical doc. */
  key: string
  title: string
  content: string
  /** Language label (e.g. 'markdown'); drives highlight + markdown toggle. */
  language: string
}

interface BackendFile {
  path: string
  content: string
  language: string
  size: number
  truncated: boolean
  mtime_ms: number
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
  /** Open (or focus) a tab whose content is supplied inline — no disk read. */
  openContent: (tab: ContentTab) => void
  setActive: (path: string) => void
  setViewMode: (path: string, mode: FileViewMode) => void
  setMarkdownView: (path: string, view: MarkdownView) => void
  /**
   * Refresh a tab's on-disk baseline after a save or external-change reload —
   * keeps `content`/`size`/`mtimeMs` (the save-conflict signature) in sync
   * with what's actually on disk. The live Monaco model is updated separately.
   */
  syncDisk: (path: string, patch: DiskPatch) => void
  close: (path: string) => void
  closeAll: () => void
}

export interface DiskPatch {
  content: string
  mtimeMs: number
  size: number
}

const EMPTY_FILE_TABS: FileTab[] = []

export function useFileTabs(tabId: string): UseFileTabsResult {
  // Per-tab so open files survive switching to another tab and back, instead
  // of being lost (single-pane) or duplicated (one hook instance per tab).
  const [tabs, setTabs] = useTabState<FileTab[]>(tabId, 'fileTabs', EMPTY_FILE_TABS)
  const [activePath, setActivePath] = useTabState<string | null>(
    tabId,
    'fileActivePath',
    null,
  )

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
          mtimeMs: 0,
          loading: true,
          error: null,
          pending,
          viewMode: initialMode,
          markdownView: 'rendered',
        },
      ]
    })
    try {
      const r = await invoke<BackendFile>('read_file_text', { path })
      setTabs((prev) =>
        prev.map((t) =>
          t.path === path
            ? {
                ...t,
                content: r.content,
                language: r.language,
                size: r.size,
                truncated: r.truncated,
                mtimeMs: r.mtime_ms,
                loading: false,
                error: null,
              }
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
  }, [setTabs, setActivePath])

  const openContent = useCallback((tab: ContentTab) => {
    const { key, title, content, language } = tab
    setActivePath(key)
    setTabs((prev) => {
      const next: FileTab = {
        path: key,
        title,
        content,
        language,
        size: new Blob([content]).size,
        truncated: false,
        mtimeMs: 0,
        loading: false,
        error: null,
        pending: null,
        viewMode: 'normal',
        markdownView: 'rendered',
        virtual: true,
      }
      const existing = prev.find((t) => t.path === key)
      if (existing) {
        // Refresh content in place (e.g. a wiki file edited since last open)
        // while preserving the user's markdown rendered/source toggle.
        return prev.map((t) =>
          t.path === key
            ? { ...next, markdownView: t.markdownView }
            : t,
        )
      }
      return [...prev, next]
    })
  }, [setTabs, setActivePath])

  const setActive = useCallback(
    (path: string) => setActivePath(path),
    [setActivePath],
  )

  const setViewMode = useCallback(
    (path: string, mode: FileViewMode) => {
      setTabs((prev) =>
        prev.map((t) => (t.path === path ? { ...t, viewMode: mode } : t)),
      )
    },
    [setTabs],
  )

  const setMarkdownView = useCallback(
    (path: string, view: MarkdownView) => {
      setTabs((prev) =>
        prev.map((t) => (t.path === path ? { ...t, markdownView: view } : t)),
      )
    },
    [setTabs],
  )

  const syncDisk = useCallback(
    (path: string, patch: DiskPatch) => {
      setTabs((prev) =>
        prev.map((t) =>
          t.path === path
            ? {
                ...t,
                content: patch.content,
                mtimeMs: patch.mtimeMs,
                size: patch.size,
              }
            : t,
        ),
      )
    },
    [setTabs],
  )

  const close = useCallback(
    (path: string) => {
      const cur = peekTabState<FileTab[]>(tabId, 'fileTabs', EMPTY_FILE_TABS)
      const next = cur.filter((t) => t.path !== path)
      setTabs(next)
      const active = peekTabState<string | null>(tabId, 'fileActivePath', null)
      if (path === active) {
        setActivePath(next.length ? next[next.length - 1].path : null)
      }
    },
    [tabId, setTabs, setActivePath],
  )

  const closeAll = useCallback(() => {
    setTabs([])
    setActivePath(null)
  }, [setTabs, setActivePath])

  return {
    tabs,
    activePath,
    open,
    openContent,
    setActive,
    setViewMode,
    setMarkdownView,
    syncDisk,
    close,
    closeAll,
  }
}
