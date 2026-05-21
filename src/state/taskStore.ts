/**
 * Global Task store.
 *
 * Tasks are project/worktree/session-independent, so this is a single
 * flat list rather than the per-project map the old knowledge store
 * used. One store instance for the whole app.
 */
import type { TaskSummary } from '../types/task'

interface TaskState {
  tasks: TaskSummary[]
  loaded: boolean
}

let state: TaskState = { tasks: [], loaded: false }
const subscribers = new Set<() => void>()

function notify() {
  for (const cb of subscribers) cb()
}

export function getTaskSnapshot(): TaskState {
  return state
}

export function subscribeTasks(cb: () => void): () => void {
  subscribers.add(cb)
  return () => {
    subscribers.delete(cb)
  }
}

export function setTasks(tasks: TaskSummary[]): void {
  state = { tasks, loaded: true }
  notify()
}

export function upsertTask(task: TaskSummary): void {
  // Bubble the touched task to the top so the browser reflects it as
  // the most-recent — matches the backend's `updated_at_ms` ordering.
  const rest = state.tasks.filter((t) => t.id !== task.id)
  state = { tasks: [task, ...rest], loaded: state.loaded }
  notify()
}

export function removeTask(taskId: string): void {
  state = {
    tasks: state.tasks.filter((t) => t.id !== taskId),
    loaded: state.loaded,
  }
  notify()
}
