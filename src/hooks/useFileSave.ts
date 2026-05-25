import { useCallback, useEffect, useRef, useState } from 'react'
import { invoke } from '@tauri-apps/api/core'
import * as monaco from 'monaco-editor'
import type { DiskPatch, FileTab } from './useFileTabs'
import { isDirty, markClean } from '../state/workingCopyStore'

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

  // IntelliJ-style focus refresh: when the window regains focus, check the
  // active real file for an external change. Clean files reload silently;
  // dirty files raise the conflict dialog.
  useEffect(() => {
    const onFocus = async () => {
      if (conflictRef.current) return
      for (const t of tabsRef.current) {
        if (t.virtual || t.truncated || t.loading || t.error) continue
        let stat: { mtime_ms: number; size: number }
        try {
          stat = await invoke<{ mtime_ms: number; size: number }>('stat_file', {
            path: t.path,
          })
        } catch {
          continue
        }
        if (stat.mtime_ms === t.mtimeMs && stat.size === t.size) continue
        const disk = await invoke<BackendFile>('read_file_text', { path: t.path })
        if (!isDirty(t.path)) {
          const model = modelFor(t.path)
          if (model && model.getValue() !== disk.content) {
            model.setValue(disk.content)
            markClean(t.path)
          }
          onSyncRef.current(t.path, {
            content: disk.content,
            mtimeMs: disk.mtime_ms,
            size: disk.size,
          })
        } else if (!conflictRef.current) {
          const model = modelFor(t.path)
          setConflict({
            path: t.path,
            memoryContent: model ? model.getValue() : t.content,
            diskContent: disk.content,
            diskMtimeMs: disk.mtime_ms,
            diskSize: disk.size,
            language: disk.language,
          })
        }
      }
    }
    window.addEventListener('focus', onFocus)
    return () => window.removeEventListener('focus', onFocus)
  }, [])

  return {
    conflict,
    save,
    resolveLoadDisk,
    resolveKeepMemory,
    resolveMerged,
    dismissConflict,
  }
}
