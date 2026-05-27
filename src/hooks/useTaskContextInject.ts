import { useCallback } from 'react'
import { invoke } from '../platform/ipc'
import type { Task } from '../types/task'
import { buildTaskContextDirective } from '../utils/taskContext'
import { logBackendError } from '../utils/log'

interface Options {
  sessionId: string | null
  sendUserMessage: (text: string) => Promise<void>
  /**
   * Register the task with the fallback watcher (see
   * `useTaskContextInjectFallback`) so prompt injection still happens if the
   * model ignores the directive and never calls `load_task_context`.
   */
  onDirectiveSent: (taskId: string) => void
}

export interface UseTaskContextInjectResult {
  inject: (taskId: string) => Promise<void>
}

/**
 * Inject a Task's context into the currently open session, on demand.
 *
 * There is no binding — this is a one-shot action against whichever session
 * is active. We send a short directive asking the model to call the in-app
 * `load_task_context` MCP tool, so the Task's content enters the conversation
 * as a *visible tool call* rather than a giant pasted user turn. The bulky
 * description + sources arrive as the tool result.
 *
 * If the model ignores the directive and never calls the tool,
 * `useTaskContextInjectFallback` re-injects the full Task markdown the legacy
 * way.
 */
export function useTaskContextInject({
  sessionId,
  sendUserMessage,
  onDirectiveSent,
}: Options): UseTaskContextInjectResult {
  const inject = useCallback(
    async (taskId: string) => {
      if (!sessionId) return
      try {
        // Pull the task for its name. Sources are loaded lazily by the MCP
        // tool on the backend, so we don't need them here.
        const task = await invoke<Task>('get_task', { taskId })
        // Arm the fallback watcher before we await the send, so it's
        // listening for the directive turn.
        onDirectiveSent(taskId)
        await sendUserMessage(buildTaskContextDirective(task))
      } catch (e) {
        logBackendError('tasks', 'context injection', e)
      }
    },
    [sessionId, sendUserMessage, onDirectiveSent],
  )

  return { inject }
}
