import { useCallback, useEffect, useRef, useState } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import * as monaco from 'monaco-editor'
import type { DiskPatch, FileTab } from './useFileTabs'
import { isDirty, markClean } from '../state/workingCopyStore'
import { notifyDocumentSaved } from '../editor/lsp/saveNotifier'

interface BackendFile {
  path: string
  content: string
  language: string
  size: number
  truncated: boolean
  mtime_ms: number
}

type WriteOutcome =
  | { status: 'written'; mtime_ms: number; size: number }
  | { status: 'conflict'; mtime_ms: number; size: number }

/**
 * A save was refused (or a focus refresh found a divergence) because the file
 * on disk no longer matches what the editor last loaded. Carries both versions
 * so the IntelliJ-style "File Cache Conflict" dialog can resolve it.
 */
export interface FileConflict {
  path: string
  /** Editor (in-memory) content when the conflict was detected. */
  memoryContent: string
  /** Current on-disk content. */
  diskContent: string
  diskMtimeMs: number
  diskSize: number
  language: string
}

export interface UseFileSaveResult {
  conflict: FileConflict | null
  /** Persist the focused file (Ctrl/Cmd+S). */
  save: (path: string) => Promise<void>
  /** Disk wins — discard in-memory edits and reload ("Load FS Changes"). */
  resolveLoadDisk: () => void
  /** Memory wins — overwrite disk with the editor content ("Keep Memory Changes"). */
  resolveKeepMemory: () => Promise<void>
  /** Apply a merged result (from "Show Difference") and overwrite disk. */
  resolveMerged: (merged: string) => Promise<void>
  /** Close the dialog without resolving — the file stays dirty. */
  dismissConflict: () => void
}

function modelFor(path: string): monaco.editor.ITextModel | null {
  return monaco.editor.getModel(monaco.Uri.file(path))
}

/**
 * Save coordination + IntelliJ-style external-modification conflict handling.
 *
 * Conflict detection mirrors VS Code's dirty-write guard: the `(mtime, size)`
 * signature recorded at load/save is sent as the expected state; the backend
 * refuses to overwrite if disk has diverged. On a refusal — or when a window
 * refocus finds a dirty file changed underneath us — we surface the conflict
 * dialog instead of silently clobbering either side. A clean file whose disk
 * copy changed is reloaded in place (like IntelliJ's silent `reloadFromDisk`).
 */
export function useFileSave(
  tabs: FileTab[],
  onSyncTab: (path: string, patch: DiskPatch) => void,
): UseFileSaveResult {
  const [conflict, setConflict] = useState<FileConflict | null>(null)

  const tabsRef = useRef(tabs)
  tabsRef.current = tabs
  const conflictRef = useRef<FileConflict | null>(conflict)
  conflictRef.current = conflict
  const onSyncRef = useRef(onSyncTab)
  onSyncRef.current = onSyncTab

  const save = useCallback(async (path: string) => {
    const tab = tabsRef.current.find((t) => t.path === path)
    if (!tab || tab.virtual || tab.truncated) return
    const model = modelFor(path)
    if (!model) return
    const content = model.getValue()
    const res = await invoke<WriteOutcome>('write_file', {
      args: {
        path,
        content,
        expected_mtime_ms: tab.mtimeMs,
        expected_size: tab.size,
        force: false,
      },
    })
    if (res.status === 'written') {
      markClean(path)
      notifyDocumentSaved(path)
      onSyncRef.current(path, {
        content,
        mtimeMs: res.mtime_ms,
        size: res.size,
      })
      return
    }
    const disk = await invoke<BackendFile>('read_file_text', { path })
    setConflict({
      path,
      memoryContent: content,
      diskContent: disk.content,
      diskMtimeMs: disk.mtime_ms,
      diskSize: disk.size,
      language: disk.language,
    })
  }, [])

  const resolveLoadDisk = useCallback(() => {
    const c = conflictRef.current
    if (!c) return
    const model = modelFor(c.path)
    if (model) {
      model.setValue(c.diskContent)
      markClean(c.path)
    }
    onSyncRef.current(c.path, {
      content: c.diskContent,
      mtimeMs: c.diskMtimeMs,
      size: c.diskSize,
    })
    setConflict(null)
  }, [])

  const forceWrite = useCallback(async (path: string, content: string) => {
    const res = await invoke<WriteOutcome>('write_file', {
      args: { path, content, force: true },
    })
    const model = modelFor(path)
    if (model && model.getValue() !== content) model.setValue(content)
    if (model) markClean(path)
    if (res.status === 'written') {
      notifyDocumentSaved(path)
      onSyncRef.current(path, {
        content,
        mtimeMs: res.mtime_ms,
        size: res.size,
      })
    }
    setConflict(null)
  }, [])

  const resolveKeepMemory = useCallback(async () => {
    const c = conflictRef.current
    if (!c) return
    const model = modelFor(c.path)
    await forceWrite(c.path, model ? model.getValue() : c.memoryContent)
  }, [forceWrite])

  const resolveMerged = useCallback(
    async (merged: string) => {
      const c = conflictRef.current
      if (!c) return
      await forceWrite(c.path, merged)
    },
    [forceWrite],
  )

  const dismissConflict = useCallback(() => setConflict(null), [])

  // Reconcile one open file against disk: clean buffers reload silently (like
  // IntelliJ's `reloadFromDisk` / VS Code's in-place revert), dirty buffers
  // raise the conflict dialog rather than clobbering either side.
  const reconcilePath = useCallback(async (path: string) => {
    if (conflictRef.current) return
    const t = tabsRef.current.find((tab) => tab.path === path)
    if (!t || t.virtual || t.truncated || t.loading || t.error) return
    let disk: BackendFile
    try {
      disk = await invoke<BackendFile>('read_file_text', { path })
    } catch {
      return
    }
    if (disk.mtime_ms === t.mtimeMs && disk.size === t.size) return
    if (!isDirty(path)) {
      const model = modelFor(path)
      if (model && model.getValue() !== disk.content) {
        model.setValue(disk.content)
        markClean(path)
      }
      onSyncRef.current(path, {
        content: disk.content,
        mtimeMs: disk.mtime_ms,
        size: disk.size,
      })
    } else if (!conflictRef.current) {
      const model = modelFor(path)
      setConflict({
        path,
        memoryContent: model ? model.getValue() : t.content,
        diskContent: disk.content,
        diskMtimeMs: disk.mtime_ms,
        diskSize: disk.size,
        language: disk.language,
      })
    }
  }, [])

  // Live external-change detection: the backend watches exactly the open files
  // and pushes `file:external-change` when one moves on disk — VS Code reloads
  // (or flags) open editors immediately, not just on refocus. Keyed on the path
  // set so a save / content sync doesn't needlessly rebuild the watcher.
  const watchKey = tabs
    .filter((t) => !t.virtual && !t.truncated && !t.loading && !t.error)
    .map((t) => t.path)
    .sort()
    .join('\n')
  useEffect(() => {
    const paths = watchKey ? watchKey.split('\n') : []
    void invoke('set_watched_files', { args: { paths } })
  }, [watchKey])

  useEffect(() => {
    const un = listen<{ path: string }>('file:external-change', (e) => {
      void reconcilePath(e.payload.path)
    })
    return () => {
      void un.then((f) => f())
    }
  }, [reconcilePath])

  // Refocus backstop: a watcher can miss events (network mounts, platform
  // quirks), so still revalidate every open file when the window regains focus.
  useEffect(() => {
    const onFocus = () => {
      if (conflictRef.current) return
      for (const t of tabsRef.current) void reconcilePath(t.path)
    }
    window.addEventListener('focus', onFocus)
    return () => window.removeEventListener('focus', onFocus)
  }, [reconcilePath])

  return {
    conflict,
    save,
    resolveLoadDisk,
    resolveKeepMemory,
    resolveMerged,
    dismissConflict,
  }
}
