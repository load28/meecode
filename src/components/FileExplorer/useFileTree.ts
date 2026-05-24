import { useCallback, useEffect, useRef, useState } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'

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

/** Payload of the backend `project_fs:changed` event. */
interface FsChangedPayload {
  root: string
  /** Directories whose listing changed, with their fresh entries. */
  updated: { dir: string; entries: DirEntry[] }[]
  /** Directories that no longer exist (drop them and their descendants). */
  removed: string[]
}

/** Whether `child` is `dir` itself or nested beneath it (either separator). */
function isUnder(child: string, dir: string): boolean {
  return child === dir || child.startsWith(dir + '/') || child.startsWith(dir + '\\')
}

/**
 * IDE-style directory tree for the file explorer, modelled on VS Code's
 * Explorer. Opening a project starts a recursive native file watcher in the
 * backend (`watch_project`) and primes a per-project directory cache. Children
 * are still read lazily — one level per `list_dir`, served read-through from
 * that cache — but the watcher pushes coalesced `project_fs:changed` deltas so
 * the tree updates live (files Claude creates appear without a manual
 * refresh), and re-expanding a folder is instant. Only the directories the
 * user has actually loaded are reconciled.
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

  const load = useCallback(
    async (path: string, refresh = false) => {
      setLoading((prev) => {
        const next = new Set(prev)
        next.add(path)
        return next
      })
      try {
        const entries = await invoke<DirEntry[]>('list_dir', {
          path,
          root: rootPath,
          refresh,
        })
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
    },
    [rootPath],
  )

  // On project change: reset, start the watcher (which returns the root
  // listing), and subscribe to live filesystem deltas.
  useEffect(() => {
    let cancelled = false
    setChildrenByDir({})
    setErrors({})
    setExpanded(new Set([rootPath]))
    setLoading((prev) => {
      const next = new Set(prev)
      next.add(rootPath)
      return next
    })

    invoke<DirEntry[]>('watch_project', { root: rootPath })
      .then((entries) => {
        if (cancelled) return
        setChildrenByDir({ [rootPath]: entries })
        setErrors((prev) => {
          if (!(rootPath in prev)) return prev
          const next = { ...prev }
          delete next[rootPath]
          return next
        })
      })
      .catch((e) => {
        if (!cancelled) setErrors((prev) => ({ ...prev, [rootPath]: String(e) }))
      })
      .finally(() => {
        if (cancelled) return
        setLoading((prev) => {
          const next = new Set(prev)
          next.delete(rootPath)
          return next
        })
      })

    const unlisten = listen<FsChangedPayload>('project_fs:changed', (e) => {
      const p = e.payload
      if (p.root !== rootPath) return

      if (p.updated.length > 0) {
        setChildrenByDir((prev) => {
          const next = { ...prev }
          for (const u of p.updated) next[u.dir] = u.entries
          return next
        })
      }

      if (p.removed.length > 0) {
        const gone = (k: string) => p.removed.some((d) => isUnder(k, d))
        setChildrenByDir((prev) => {
          const next: Record<string, DirEntry[]> = {}
          for (const [k, v] of Object.entries(prev)) {
            if (!gone(k)) next[k] = v
          }
          return next
        })
        setExpanded((prev) => {
          const next = new Set<string>()
          for (const k of prev) if (!gone(k)) next.add(k)
          return next
        })
      }
    })

    return () => {
      cancelled = true
      unlisten.then((f) => f()).catch(() => {})
    }
  }, [rootPath])

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
      void load(path, true)
    },
    [load],
  )

  return { rootPath, childrenByDir, expanded, loading, errors, toggle, reload }
}
