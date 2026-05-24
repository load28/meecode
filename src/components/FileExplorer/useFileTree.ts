import { useCallback, useEffect, useRef, useState } from 'react'
import { invoke } from '@tauri-apps/api/core'

export interface DirEntry {
  name: string
  path: string
  is_dir: boolean
}

export interface UseFileTreeResult {
  rootPath: string
  /** Loaded children keyed by directory path. Absence = not loaded yet. */
  childrenByDir: Record<string, DirEntry[]>
  /** Directory paths the user has expanded. */
  expanded: Set<string>
  /** Directory paths with an in-flight `list_dir`. */
  loading: Set<string>
  /** Per-directory load error, keyed by directory path. */
  errors: Record<string, string>
  /** Expand/collapse a directory; loads its children on first expand. */
  toggle: (path: string) => void
  /** Force a re-read of a directory (e.g. the refresh button). */
  reload: (path: string) => void
}

/**
 * Lazy directory tree for the file explorer. Children are fetched one level
 * at a time via the `list_dir` backend command and cached by path, so even a
 * large project only reads the folders the user actually opens. The project
 * root is loaded and expanded automatically whenever `rootPath` changes.
 */
export function useFileTree(rootPath: string): UseFileTreeResult {
  const [childrenByDir, setChildrenByDir] = useState<
    Record<string, DirEntry[]>
  >({})
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set())
  const [loading, setLoading] = useState<Set<string>>(() => new Set())
  const [errors, setErrors] = useState<Record<string, string>>({})

  // Refs let `toggle` read current state without re-creating the callback
  // (and without capturing a stale closure across renders).
  const childrenRef = useRef(childrenByDir)
  childrenRef.current = childrenByDir
  const expandedRef = useRef(expanded)
  expandedRef.current = expanded

  const load = useCallback(async (path: string) => {
    setLoading((prev) => {
      const next = new Set(prev)
      next.add(path)
      return next
    })
    try {
      const entries = await invoke<DirEntry[]>('list_dir', { path })
      setChildrenByDir((prev) => ({ ...prev, [path]: entries }))
      setErrors((prev) => {
        if (!(path in prev)) return prev
        const next = { ...prev }
        delete next[path]
        return next
      })
    } catch (e) {
      setErrors((prev) => ({ ...prev, [path]: String(e) }))
    } finally {
      setLoading((prev) => {
        const next = new Set(prev)
        next.delete(path)
        return next
      })
    }
  }, [])

  // Reset and load the root whenever the project changes.
  useEffect(() => {
    setChildrenByDir({})
    setErrors({})
    setExpanded(new Set([rootPath]))
    void load(rootPath)
  }, [rootPath, load])

  const toggle = useCallback(
    (path: string) => {
      if (expandedRef.current.has(path)) {
        setExpanded((prev) => {
          const next = new Set(prev)
          next.delete(path)
          return next
        })
      } else {
        setExpanded((prev) => {
          const next = new Set(prev)
          next.add(path)
          return next
        })
        if (!childrenRef.current[path]) void load(path)
      }
    },
    [load],
  )

  const reload = useCallback(
    (path: string) => {
      void load(path)
    },
    [load],
  )

  return { rootPath, childrenByDir, expanded, loading, errors, toggle, reload }
}
