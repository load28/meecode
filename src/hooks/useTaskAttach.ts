import { useCallback } from 'react'
import { invoke } from '@tauri-apps/api/core'
import type { Task } from '../types/task'
import { buildTaskAttachDirective } from '../utils/taskContext'
import { logBackendError } from '../utils/log'
import type { UseSessionBindingsResult } from './useSessionBindings'

interface Options {
  sessionId: string | null
  sessionBindings: UseSessionBindingsResult
  sendUserMessage: (text: string) => Promise<void>
  /**
   * Register the attached task with the fallback watcher (see
   * `useTaskAttachFallback`) so prompt injection still happens if the model
   * ignores the directive and never calls `load_task_context`.
   */
  onDirectiveSent: (taskId: string) => void
}

export interface UseTaskAttachResult {
  attach: (taskId: string) => Promise<void>
  detach: (taskId: string) => Promise<void>
}

/**
 * Attach / detach a Task to the current session.
 *
 * On attach we send a short directive asking the model to call the in-app
 * `load_task_context` MCP tool, so the Task's content enters the conversation
 * as a *visible tool call* rather than a giant pasted user turn. The bulky
 * description + sources arrive as the tool result.
 *
 * Attach flow:
 *   1. persist the binding (cheap, instant UI flip),
 *   2. fetch the Task (for its name) from the backend,
 *   3. send the directive turn and register it with the fallback watcher.
 *
 * If the model ignores the directive and never calls the tool,
 * `useTaskAttachFallback` re-injects the full Task markdown the legacy way.
 *
 * Detach is a thin wrapper over `sessionBindings.detach`; kept here so
 * the public surface ('handlers for the attach/detach buttons') is one
 * cohesive unit.
 */
export function useTaskAttach({
  sessionId,
  sessionBindings,
  sendUserMessage,
  onDirectiveSent,
}: Options): UseTaskAttachResult {
  const attach = useCallback(
    async (taskId: string) => {
      if (!sessionId) return
      // 1. Persist the binding first so the UI flips immediately and the
      //    binding survives even if the inject step below errors out.
      const binding = await sessionBindings.attach(taskId)
      if (!binding) return
      // 2. Pull the task for its name. Sources are loaded lazily by the MCP
      //    tool on the backend, so we don't need them here.
      try {
        const task = await invoke<Task>('get_task', { taskId })
        // 3. Send the short directive and arm the fallback watcher before
        //    we await the send, so it's listening for the directive turn.
        onDirectiveSent(taskId)
        await sendUserMessage(buildTaskAttachDirective(task))
      } catch (e) {
        logBackendError('tasks', 'context injection', e)
      }
    },
    [sessionId, sessionBindings, sendUserMessage, onDirectiveSent],
  )

  const detach = useCallback(
    async (taskId: string) => {
      await sessionBindings.detach(taskId)
    },
    [sessionBindings],
  )

  return { attach, detach }
}
