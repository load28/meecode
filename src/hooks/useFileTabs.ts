import { useCallback, useState } from 'react'
import { invoke } from '@tauri-apps/api/core'

export interface FileTab {
  path: string
  content: string
  language: string
  size: number
  truncated: boolean
  loading: boolean
  error: string | null
}

interface BackendFile {
  path: string
  content: string
  language: string
  size: number
  truncated: boolean
}

export interface UseFileTabsResult {
  tabs: FileTab[]
  activePath: string | null
  open: (path: string) => Promise<void>
  setActive: (path: string) => void
  close: (path: string) => void
  closeAll: () => void
}

export function useFileTabs(): UseFileTabsResult {
  const [tabs, setTabs] = useState<FileTab[]>([])
  const [activePath, setActivePath] = useState<string | null>(null)

  const open = useCallback(async (path: string) => {
    setActivePath(path)
    setTabs((prev) => {
      if (prev.some((t) => t.path === path)) return prev
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

  return { tabs, activePath, open, setActive, close, closeAll }
}
