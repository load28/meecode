/* eslint-disable react-hooks/exhaustive-deps */
import { useCallback, useEffect, useSyncExternalStore } from 'react'
import { invoke } from '@tauri-apps/api/core'
import type { SessionTaskBinding } from '../types/task'
import {
  getBindingsSnapshot,
  removeBinding,
  setBindings,
  subscribeBindings,
  upsertBinding,
} from '../state/bindingsStore'

export interface UseSessionBindingsResult {
  bindings: SessionTaskBinding[]
  loaded: boolean
  isAttached: (taskId: string) => boolean
  attach: (taskId: string) => Promise<SessionTaskBinding | null>
  detach: (taskId: string) => Promise<void>
  refresh: () => Promise<void>
}

/**
 * Reactive view onto the bindings for a single session.
 *
 * When `sessionId` is null (chat not yet started), the hook returns an
 * empty list and attach/detach become no-ops — callers should gate the
 * Attach UI on the same null check.
 */
export function useSessionBindings(
  sessionId: string | null,
): UseSessionBindingsResult {
  const key = sessionId ?? ''

  const snapshot = useSyncExternalStore(
    useCallback((cb: () => void) => subscribeBindings(key, cb), [key]),
    useCallback(() => getBindingsSnapshot(key), [key]),
  )
  const bindings = snapshot ?? []
  const loaded = snapshot !== undefined

  const refresh = useCallback(async () => {
    if (!sessionId) return
    try {
      const list = await invoke<SessionTaskBinding[]>(
        'list_session_task_bindings',
        { sessionId },
      )
      setBindings(sessionId, list)
    } catch (e) {
      console.warn('[bindings] list_session_task_bindings failed', e)
    }
  }, [sessionId])

  useEffect(() => {
    if (sessionId && !loaded) void refresh()
  }, [sessionId, loaded])

  const isAttached = useCallback(
    (taskId: string) => bindings.some((b) => b.task_id === taskId),
    [bindings],
  )

  const attach = useCallback(
    async (taskId: string): Promise<SessionTaskBinding | null> => {
      if (!sessionId) return null
      try {
        const created = await invoke<SessionTaskBinding>('attach_task', {
          args: { session_id: sessionId, task_id: taskId },
        })
        upsertBinding(created)
        return created
      } catch (e) {
        console.warn('[bindings] attach_task failed', e)
        return null
      }
    },
    [sessionId],
  )

  const detach = useCallback(
    async (taskId: string) => {
      if (!sessionId) return
      try {
        await invoke('detach_task', {
          args: { session_id: sessionId, task_id: taskId },
        })
        removeBinding(sessionId, taskId)
      } catch (e) {
        console.warn('[bindings] detach_task failed', e)
      }
    },
    [sessionId],
  )

  return { bindings, loaded, isAttached, attach, detach, refresh }
}
