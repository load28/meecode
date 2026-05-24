import { useCallback, useEffect, useRef, useState } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { basename, joinPath, parentPath } from './paths'

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
  /** Expand a directory (loading children on first expand) without toggling. */
  expand: (path: string) => void
  /** Collapse every expanded directory (VS Code's "Collapse Folders"). */
  collapseAll: () => void
  /** Create an empty file or folder named `name` under `parentDir`. */
  create: (parentDir: string, name: string, isDir: boolean) => Promise<void>
  /** Rename `path` to a sibling named `newName`. */
  rename: (path: string, newName: string) => Promise<void>
  /** Move `path` into `targetDir`, keeping its basename. */
  move: (path: string, targetDir: string) => Promise<void>
  /** Delete a file or directory (recursive for directories). */
  remove: (path: string) => Promise<void>
}

/** Payload of the backend `project_fs:changed` event. */
interface FsChangedPayload {
  root: string
  /** Directories whose listing changed, with their fresh entries. */
  updated: { dir: string; entries: DirEntry[] }[]
  /** Directories that no longer exist (drop them and their descendants). */
  removed: string[]
  /** Atomic dir moves/renames; re-root keys instead of dropping them. */
  renamed: { from: string; to: string }[]
}

/** Whether `child` is `dir` itself or nested beneath it (either separator). */
function isUnder(child: string, dir: string): boolean {
  return child === dir || child.startsWith(dir + '/') || child.startsWith(dir + '\\')
}

/**
 * Re-root `key` from under `from` to under `to` when it matches, else return
 * `null`. Mirrors the backend's `remap_key` so a moved dir's loaded children
 * and expansion follow it to the new path.
 */
function remapKey(key: string, from: string, to: string): string | null {
  if (key === from) return to
  if (key.startsWith(from + '/') || key.startsWith(from + '\\')) {
    return to + key.slice(from.length)
  }
  return null
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

      // Renames first: carry the expanded state to the new path, and drop the
      // stale source keys from the cache (the `updated` entries below re-supply
      // the destination keys with corrected child paths).
      if (p.renamed.length > 0) {
        const remap = (k: string): string => {
          for (const r of p.renamed) {
            const m = remapKey(k, r.from, r.to)
            if (m !== null) return m
          }
          return k
        }
        const movedFrom = (k: string) =>
          p.renamed.some((r) => remapKey(k, r.from, r.to) !== null)
        setExpanded((prev) => {
          const next = new Set<string>()
          for (const k of prev) next.add(remap(k))
          return next
        })
        setChildrenByDir((prev) => {
          const next: Record<string, DirEntry[]> = {}
          for (const [k, v] of Object.entries(prev)) {
            if (!movedFrom(k)) next[k] = v
          }
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

      if (p.updated.length > 0) {
        setChildrenByDir((prev) => {
          const next = { ...prev }
          for (const u of p.updated) next[u.dir] = u.entries
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

  const expand = useCallback(
    (path: string) => {
      setExpanded((prev) => {
        if (prev.has(path)) return prev
        const next = new Set(prev)
        next.add(path)
        return next
      })
      if (!childrenRef.current[path]) void load(path)
    },
    [load],
  )

  const collapseAll = useCallback(() => {
    setExpanded(new Set())
  }, [])

  // Mutations write to disk and let the file watcher's `project_fs:changed`
  // delta reconcile the tree — the same flow VS Code uses, where its file
  // service performs the operation and the explorer model updates from the
  // resulting filesystem event rather than mutating the view optimistically.
  const create = useCallback(
    async (parentDir: string, name: string, isDir: boolean) => {
      await invoke('create_entry', { path: joinPath(parentDir, name), isDir })
    },
    [],
  )

  const rename = useCallback(async (path: string, newName: string) => {
    const to = joinPath(parentPath(path), newName)
    if (to === path) return
    await invoke('rename_entry', { from: path, to })
  }, [])

  const move = useCallback(async (path: string, targetDir: string) => {
    await invoke('rename_entry', { from: path, to: joinPath(targetDir, basename(path)) })
  }, [])

  const remove = useCallback(async (path: string) => {
    await invoke('delete_entry', { path })
  }, [])

  return {
    rootPath,
    childrenByDir,
    expanded,
    loading,
    errors,
    toggle,
    reload,
    expand,
    collapseAll,
    create,
    rename,
    move,
    remove,
  }
}
