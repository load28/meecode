/* eslint-disable react-hooks/exhaustive-deps */
import { useCallback, useEffect, useSyncExternalStore } from 'react'
import { invoke } from '@tauri-apps/api/core'
import type { Pin, WikiFileMeta } from '../types'
import {
  getKnowledgeSnapshot,
  setKnowledge,
  subscribeKnowledge,
} from '../state/knowledgeStore'

interface PinSnippetInput {
  segmentKind: string
  text: string
  sessionId?: string | null
  qaId?: string | null
}

export interface UseProjectKnowledgeResult {
  pins: Pin[]
  wiki: WikiFileMeta[]
  status: 'idle' | 'running' | 'diff-ready' | 'error'
  progressChars: number
  diff: ReturnType<typeof getKnowledgeSnapshot>['diff']
  error: string | null
  refreshPins: () => Promise<void>
  refreshWiki: () => Promise<void>
  pin: (input: PinSnippetInput) => Promise<Pin | null>
  unpin: (pinId: string) => Promise<void>
  readWiki: (fileName: string) => Promise<string>
  applyWikiDiff: (fileName: string, content: string) => Promise<void>
  deleteWiki: (fileName: string) => Promise<void>
  startOrganize: () => Promise<void>
  cancelOrganize: () => Promise<void>
  dismissDiff: () => void
}

export function useProjectKnowledge(
  projectPath: string | null,
): UseProjectKnowledgeResult {
  const path = projectPath ?? ''
  const snapshot = useSyncExternalStore(
    useCallback((cb: () => void) => subscribeKnowledge(path, cb), [path]),
    useCallback(() => getKnowledgeSnapshot(path), [path]),
  )

  const refreshPins = useCallback(async () => {
    if (!projectPath) return
    try {
      const pins = await invoke<Pin[]>('list_project_pins', {
        projectPath,
      })
      setKnowledge(projectPath, (s) => ({ ...s, pins }))
    } catch (e) {
      console.warn('[knowledge] list_project_pins failed', e)
    }
  }, [projectPath])

  const refreshWiki = useCallback(async () => {
    if (!projectPath) return
    try {
      const wiki = await invoke<WikiFileMeta[]>('list_project_wiki', {
        projectPath,
      })
      setKnowledge(projectPath, (s) => ({ ...s, wiki }))
    } catch (e) {
      console.warn('[knowledge] list_project_wiki failed', e)
    }
  }, [projectPath])

  // Load on project change.
  useEffect(() => {
    if (!projectPath) return
    refreshPins()
    refreshWiki()
  }, [projectPath])

  const pin = useCallback(
    async (input: PinSnippetInput): Promise<Pin | null> => {
      if (!projectPath) return null
      try {
        const created = await invoke<Pin>('pin_snippet', {
          args: {
            project_path: projectPath,
            session_id: input.sessionId ?? null,
            qa_id: input.qaId ?? null,
            segment_kind: input.segmentKind,
            text: input.text,
          },
        })
        setKnowledge(projectPath, (s) => ({
          ...s,
          pins: [...s.pins, created],
        }))
        return created
      } catch (e) {
        console.warn('[knowledge] pin_snippet failed', e)
        return null
      }
    },
    [projectPath],
  )

  const unpin = useCallback(
    async (pinId: string) => {
      if (!projectPath) return
      try {
        await invoke('delete_project_pin', {
          args: { project_path: projectPath, pin_id: pinId },
        })
        setKnowledge(projectPath, (s) => ({
          ...s,
          pins: s.pins.filter((p) => p.id !== pinId),
        }))
      } catch (e) {
        console.warn('[knowledge] delete_project_pin failed', e)
      }
    },
    [projectPath],
  )

  const readWiki = useCallback(
    async (fileName: string): Promise<string> => {
      if (!projectPath) return ''
      try {
        return await invoke<string>('read_project_wiki', {
          args: { project_path: projectPath, file_name: fileName },
        })
      } catch (e) {
        console.warn('[knowledge] read_project_wiki failed', e)
        return ''
      }
    },
    [projectPath],
  )

  const applyWikiDiff = useCallback(
    async (fileName: string, content: string) => {
      if (!projectPath) return
      try {
        await invoke('apply_wiki_diff', {
          args: {
            project_path: projectPath,
            file_name: fileName,
            content,
          },
        })
        await refreshWiki()
        // Drop the applied entry from the in-memory diff list.
        setKnowledge(projectPath, (s) => {
          if (!s.diff) return s
          const next = s.diff.filter((d) => d.name !== fileName)
          return { ...s, diff: next.length ? next : null }
        })
      } catch (e) {
        console.warn('[knowledge] apply_wiki_diff failed', e)
      }
    },
    [projectPath, refreshWiki],
  )

  const deleteWiki = useCallback(
    async (fileName: string) => {
      if (!projectPath) return
      try {
        await invoke('delete_project_wiki', {
          args: { project_path: projectPath, file_name: fileName },
        })
        await refreshWiki()
      } catch (e) {
        console.warn('[knowledge] delete_project_wiki failed', e)
      }
    },
    [projectPath, refreshWiki],
  )

  const startOrganize = useCallback(async () => {
    if (!projectPath) return
    try {
      await invoke('organize_notes', { projectPath })
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      setKnowledge(projectPath, (s) => ({
        ...s,
        status: 'error',
        error: msg,
      }))
    }
  }, [projectPath])

  const cancelOrganize = useCallback(async () => {
    try {
      await invoke('cancel_organize')
    } catch (e) {
      console.warn('[knowledge] cancel_organize failed', e)
    }
  }, [])

  const dismissDiff = useCallback(() => {
    if (!projectPath) return
    setKnowledge(projectPath, (s) => ({
      ...s,
      status: 'idle',
      diff: null,
      error: null,
    }))
  }, [projectPath])

  return {
    pins: snapshot.pins,
    wiki: snapshot.wiki,
    status: snapshot.status,
    progressChars: snapshot.progressChars,
    diff: snapshot.diff,
    error: snapshot.error,
    refreshPins,
    refreshWiki,
    pin,
    unpin,
    readWiki,
    applyWikiDiff,
    deleteWiki,
    startOrganize,
    cancelOrganize,
    dismissDiff,
  }
}
