/**
 * Working-copy dirty tracking — a lightweight analogue of VS Code's
 * `IWorkingCopyService` / `TextFileEditorModel` dirty machinery.
 *
 * Dirty is derived from the Monaco model's *alternative* version id compared
 * against the version recorded at the last load/save. Using the alternative id
 * (not the plain version id) reproduces VS Code's nice detail: undoing all the
 * way back to the saved state clears the dirty flag automatically.
 *
 * Keyed by file path (the model URI's fsPath), so it's shared by any editor
 * showing that file within the window.
 */
import { useCallback, useSyncExternalStore } from 'react'
import type { editor } from 'monaco-editor'

interface Entry {
  model: editor.ITextModel
  savedVersionId: number
  dirty: boolean
  disposeListener: () => void
}

const entries = new Map<string, Entry>()
const subscribers = new Map<string, Set<() => void>>()

function emit(path: string): void {
  const subs = subscribers.get(path)
  if (subs) for (const cb of subs) cb()
}

function recompute(path: string): void {
  const e = entries.get(path)
  if (!e) return
  const dirty = e.model.getAlternativeVersionId() !== e.savedVersionId
  if (dirty !== e.dirty) {
    e.dirty = dirty
    emit(path)
  }
}

/**
 * Start tracking dirty state for `path`'s model. Idempotent for the same
 * (path, model) pair so re-renders don't reset the saved snapshot. If a
 * different model is bound to the same path (file reopened after close), the
 * old listener is replaced and the snapshot reset to the new model's state.
 */
export function registerWorkingCopy(
  path: string,
  model: editor.ITextModel,
): void {
  const existing = entries.get(path)
  if (existing) {
    if (existing.model === model) return
    existing.disposeListener()
  }
  const sub = model.onDidChangeContent(() => recompute(path))
  entries.set(path, {
    model,
    savedVersionId: model.getAlternativeVersionId(),
    dirty: false,
    disposeListener: () => sub.dispose(),
  })
  emit(path)
}

/**
 * Stop tracking `path` (the file's tab closed and its model is being disposed).
 * Drops the content listener and the entry so nothing leaks per closed file.
 */
export function unregisterWorkingCopy(path: string): void {
  const e = entries.get(path)
  if (!e) return
  e.disposeListener()
  entries.delete(path)
  emit(path)
}

/** Mark the current model content as the saved baseline (clears dirty). */
export function markClean(path: string): void {
  const e = entries.get(path)
  if (!e) return
  e.savedVersionId = e.model.getAlternativeVersionId()
  if (e.dirty) {
    e.dirty = false
    emit(path)
  }
}

export function isDirty(path: string): boolean {
  return entries.get(path)?.dirty ?? false
}

/** React subscription to a single path's dirty flag. */
export function useDirty(path: string | null): boolean {
  const subscribe = useCallback(
    (cb: () => void) => {
      if (!path) return () => {}
      let subs = subscribers.get(path)
      if (!subs) {
        subs = new Set()
        subscribers.set(path, subs)
      }
      subs.add(cb)
      return () => {
        subs!.delete(cb)
      }
    },
    [path],
  )
  const getSnapshot = useCallback(
    () => (path ? isDirty(path) : false),
    [path],
  )
  return useSyncExternalStore(subscribe, getSnapshot)
}
