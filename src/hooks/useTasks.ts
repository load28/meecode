/* eslint-disable react-hooks/exhaustive-deps */
import { useCallback, useEffect, useState, useSyncExternalStore } from 'react'
import { invoke } from '@tauri-apps/api/core'
import type { Source, Task, TaskSummary } from '../types/task'
import {
  getTaskSnapshot,
  removeTask as removeTaskInStore,
  setTasks,
  subscribeTasks,
  upsertTask,
} from '../state/taskStore'

export interface UseTasksResult {
  tasks: TaskSummary[]
  loaded: boolean
  refresh: () => Promise<void>
  createTask: (name: string, description?: string) => Promise<Task | null>
  updateTask: (
    id: string,
    patch: { name?: string; description?: string },
  ) => Promise<Task | null>
  deleteTask: (id: string) => Promise<void>
}

export function useTasks(): UseTasksResult {
  const snapshot = useSyncExternalStore(subscribeTasks, getTaskSnapshot)

  const refresh = useCallback(async () => {
    try {
      const list = await invoke<TaskSummary[]>('list_tasks')
      setTasks(list)
    } catch (e) {
      console.warn('[tasks] list_tasks failed', e)
    }
  }, [])

  // First mount: load once. Other components mounting the hook later
  // reuse the cached snapshot.
  useEffect(() => {
    if (!snapshot.loaded) {
      void refresh()
    }
  }, [snapshot.loaded])

  const createTask = useCallback(
    async (name: string, description?: string): Promise<Task | null> => {
      try {
        const task = await invoke<Task>('create_task', {
          args: { name, description: description ?? null },
        })
        upsertTask({
          id: task.id,
          name: task.name,
          description: task.description,
          created_at_ms: task.created_at_ms,
          updated_at_ms: task.updated_at_ms,
          source_count: 0,
        })
        return task
      } catch (e) {
        console.warn('[tasks] create_task failed', e)
        return null
      }
    },
    [],
  )

  const updateTask = useCallback(
    async (
      id: string,
      patch: { name?: string; description?: string },
    ): Promise<Task | null> => {
      try {
        const task = await invoke<Task>('update_task', {
          args: {
            task_id: id,
            name: patch.name ?? null,
            description: patch.description ?? null,
          },
        })
        // Preserve source_count from the prior snapshot — update_task only
        // touches Task fields, not the source set.
        const prev = snapshot.tasks.find((t) => t.id === id)
        upsertTask({
          id: task.id,
          name: task.name,
          description: task.description,
          created_at_ms: task.created_at_ms,
          updated_at_ms: task.updated_at_ms,
          source_count: prev?.source_count ?? 0,
        })
        return task
      } catch (e) {
        console.warn('[tasks] update_task failed', e)
        return null
      }
    },
    [snapshot.tasks],
  )

  const deleteTask = useCallback(async (id: string) => {
    try {
      await invoke('delete_task', { taskId: id })
      removeTaskInStore(id)
    } catch (e) {
      console.warn('[tasks] delete_task failed', e)
    }
  }, [])

  return {
    tasks: snapshot.tasks,
    loaded: snapshot.loaded,
    refresh,
    createTask,
    updateTask,
    deleteTask,
  }
}

/** Standalone hook for one task's full detail (Task + Sources). */
export function useTaskDetail(taskId: string | null) {
  const [task, setTask] = useState<Task | null>(null)
  const [sources, setSources] = useState<Source[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    if (!taskId) {
      setTask(null)
      setSources([])
      return
    }
    setLoading(true)
    setError(null)
    try {
      const [t, ss] = await Promise.all([
        invoke<Task>('get_task', { taskId }),
        invoke<Source[]>('list_task_sources', { taskId }),
      ])
      setTask(t)
      setSources(ss)
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      setError(msg)
    } finally {
      setLoading(false)
    }
  }, [taskId])

  useEffect(() => {
    void refresh()
  }, [refresh])

  return { task, sources, loading, error, refresh, setTask }
}
