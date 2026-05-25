/* eslint-disable react-hooks/exhaustive-deps */
import { useCallback, useEffect, useState, useSyncExternalStore } from 'react'
import { invoke } from '@tauri-apps/api/core'
import type {
  OrganizePreview,
  Source,
  Task,
  TaskSummary,
  WikiFile,
} from '../types/task'
import {
  getTaskSnapshot,
  removeTask as removeTaskInStore,
  setTasks,
  subscribeTasks,
  upsertTask,
} from '../state/taskStore'
import {
  getOrganizeSnapshot,
  subscribeOrganize,
} from '../state/organizeStore'
import {
  getHarvestSnapshot,
  subscribeHarvest,
} from '../state/harvestStore'
import { logBackendError } from '../utils/log'

export interface CreateSourceInput {
  taskId: string
  kind: string
  title?: string
  content: string
  sessionId?: string | null
  qaId?: string | null
  projectPath?: string | null
}

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
  /**
   * Capture a Source into a Task. Returns the created Source on success.
   * Triggers a list refresh so the caller's `source_count` reflects it.
   */
  createSource: (input: CreateSourceInput) => Promise<Source | null>
}

export function useTasks(): UseTasksResult {
  const snapshot = useSyncExternalStore(subscribeTasks, getTaskSnapshot)

  const refresh = useCallback(async () => {
    try {
      const list = await invoke<TaskSummary[]>('list_tasks')
      setTasks(list)
    } catch (e) {
      logBackendError('tasks', 'list_tasks', e)
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
        logBackendError('tasks', 'create_task', e)
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
        logBackendError('tasks', 'update_task', e)
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
      logBackendError('tasks', 'delete_task', e)
    }
  }, [])

  const createSource = useCallback(
    async (input: CreateSourceInput): Promise<Source | null> => {
      try {
        const created = await invoke<Source>('create_source', {
          args: {
            task_id: input.taskId,
            kind: input.kind,
            title: input.title ?? '',
            content: input.content,
            session_id: input.sessionId ?? null,
            qa_id: input.qaId ?? null,
            project_path: input.projectPath ?? null,
          },
        })
        // The backend bumps Task.updated_at and source_count grew by one,
        // so refresh the list to reflect both. Cheaper than rebuilding
        // each entry by hand.
        void refresh()
        return created
      } catch (e) {
        logBackendError('tasks', 'create_source', e)
        return null
      }
    },
    [refresh],
  )

  return {
    tasks: snapshot.tasks,
    loaded: snapshot.loaded,
    refresh,
    createTask,
    updateTask,
    deleteTask,
    createSource,
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

  const deleteSource = useCallback(
    async (sourceId: string) => {
      if (!taskId) return
      try {
        await invoke('delete_source', {
          args: { task_id: taskId, source_id: sourceId },
        })
        setSources((prev) => prev.filter((s) => s.id !== sourceId))
      } catch (e) {
        logBackendError('tasks', 'delete_source', e)
      }
    },
    [taskId],
  )

  return { task, sources, loading, error, refresh, setTask, deleteSource }
}

/** Wiki file listing + read/write/delete for a single task. */
export function useTaskWiki(taskId: string | null) {
  const [files, setFiles] = useState<WikiFile[]>([])
  const [loading, setLoading] = useState(false)

  const refresh = useCallback(async () => {
    if (!taskId) {
      setFiles([])
      return
    }
    setLoading(true)
    try {
      const list = await invoke<WikiFile[]>('list_task_wiki_files', { taskId })
      setFiles(list)
    } catch (e) {
      logBackendError('tasks', 'list_task_wiki_files', e)
    } finally {
      setLoading(false)
    }
  }, [taskId])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const readFile = useCallback(
    async (name: string): Promise<string> => {
      if (!taskId) return ''
      try {
        return await invoke<string>('read_task_wiki', {
          args: { task_id: taskId, name },
        })
      } catch (e) {
        logBackendError('tasks', 'read_task_wiki', e)
        return ''
      }
    },
    [taskId],
  )

  const writeFile = useCallback(
    async (name: string, content: string): Promise<boolean> => {
      if (!taskId) return false
      try {
        await invoke('write_task_wiki', {
          args: { task_id: taskId, name, content },
        })
        await refresh()
        return true
      } catch (e) {
        logBackendError('tasks', 'write_task_wiki', e)
        return false
      }
    },
    [taskId, refresh],
  )

  const deleteFile = useCallback(
    async (name: string): Promise<void> => {
      if (!taskId) return
      try {
        await invoke('delete_task_wiki', {
          args: { task_id: taskId, name },
        })
        await refresh()
      } catch (e) {
        logBackendError('tasks', 'delete_task_wiki', e)
      }
    },
    [taskId, refresh],
  )

  return { files, loading, refresh, readFile, writeFile, deleteFile }
}

/** Organize trigger + reactive status. */
export function useTaskOrganize(taskId: string | null) {
  const key = taskId ?? ''
  const snapshot = useSyncExternalStore(
    useCallback((cb: () => void) => subscribeOrganize(key, cb), [key]),
    useCallback(() => getOrganizeSnapshot(key), [key]),
  )

  const [preview, setPreview] = useState<OrganizePreview | null>(null)
  const refreshPreview = useCallback(async () => {
    if (!taskId) {
      setPreview(null)
      return
    }
    try {
      const p = await invoke<OrganizePreview>('get_organize_preview', { taskId })
      setPreview(p)
    } catch (e) {
      logBackendError('organize', 'get_organize_preview', e)
    }
  }, [taskId])

  // Refresh the preview when the task changes and when an organize run
  // completes (the source count drops to 0).
  useEffect(() => {
    void refreshPreview()
  }, [refreshPreview])

  useEffect(() => {
    if (snapshot.status === 'idle' && snapshot.lastProcessedSourceIds.length > 0) {
      void refreshPreview()
    }
  }, [snapshot.status, snapshot.lastProcessedSourceIds, refreshPreview])

  const start = useCallback(async (): Promise<string | null> => {
    if (!taskId) return 'No task'
    try {
      await invoke('start_task_organize', { taskId })
      return null
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      return msg
    }
  }, [taskId])

  const cancel = useCallback(async () => {
    if (!taskId) return
    try {
      await invoke('cancel_task_organize', { taskId })
    } catch (e) {
      logBackendError('organize', 'cancel', e)
    }
  }, [taskId])

  return {
    status: snapshot.status,
    lastNote: snapshot.lastNote,
    lastProcessedSourceIds: snapshot.lastProcessedSourceIds,
    error: snapshot.error,
    preview,
    refreshPreview,
    start,
    cancel,
  }
}

/**
 * Session-harvest trigger + reactive status. Distills a chat session's
 * transcript into Sources, then the backend auto-chains organize. Only valid
 * when the session has this task attached (enforced backend-side too).
 */
export function useTaskHarvest(taskId: string | null) {
  const key = taskId ?? ''
  const snapshot = useSyncExternalStore(
    useCallback((cb: () => void) => subscribeHarvest(key, cb), [key]),
    useCallback(() => getHarvestSnapshot(key), [key]),
  )

  const start = useCallback(
    async (sessionId: string, projectPath: string): Promise<string | null> => {
      if (!taskId) return 'No task'
      try {
        await invoke('start_session_harvest', {
          args: {
            task_id: taskId,
            session_id: sessionId,
            project_path: projectPath,
          },
        })
        return null
      } catch (e) {
        return e instanceof Error ? e.message : String(e)
      }
    },
    [taskId],
  )

  const cancel = useCallback(async () => {
    if (!taskId) return
    try {
      await invoke('cancel_session_harvest', { taskId })
    } catch (e) {
      logBackendError('harvest', 'cancel', e)
    }
  }, [taskId])

  return {
    status: snapshot.status,
    lastNote: snapshot.lastNote,
    doneTick: snapshot.doneTick,
    error: snapshot.error,
    start,
    cancel,
  }
}
