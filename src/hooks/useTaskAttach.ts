import { useCallback } from 'react'
import { invoke } from '@tauri-apps/api/core'
import type { Source, Task } from '../types/task'
import { buildTaskContextMessage } from '../utils/taskContext'
import type { UseSessionBindingsResult } from './useSessionBindings'

interface Options {
  sessionId: string | null
  sessionBindings: UseSessionBindingsResult
  sendUserMessage: (text: string) => Promise<void>
}

export interface UseTaskAttachResult {
  attach: (taskId: string) => Promise<void>
  detach: (taskId: string) => Promise<void>
}

/**
 * Attach / detach a Task to the current session and (on attach) inject
 * the Task's description + Source dump as a user-role turn so the LLM
 * picks up the context once and benefits from prompt caching on the
 * follow-ups.
 *
 * Attach flow:
 *   1. persist the binding (cheap, instant UI flip),
 *   2. fetch Task + Sources from the backend on demand,
 *   3. build the context-injection message and send it as a user turn,
 *      unless the Task has nothing to inject (empty description, no
 *      sources) — in which case we just log and skip the empty turn.
 *
 * Detach is a thin wrapper over `sessionBindings.detach`; kept here so
 * the public surface ('handlers for the attach/detach buttons') is one
 * cohesive unit.
 */
export function useTaskAttach({
  sessionId,
  sessionBindings,
  sendUserMessage,
}: Options): UseTaskAttachResult {
  const attach = useCallback(
    async (taskId: string) => {
      if (!sessionId) return
      // 1. Persist the binding first so the UI flips immediately and the
      //    binding survives even if the inject step below errors out.
      const binding = await sessionBindings.attach(taskId)
      if (!binding) return
      // 2. Pull the task + sources from the backend on demand. The
      //    browser list already has a TaskSummary but lacks
      //    `description` (it does in fact, but we still need sources
      //    separately), and the source list isn't cached anywhere — go
      //    to the source of truth.
      try {
        const [task, sources] = await Promise.all([
          invoke<Task>('get_task', { taskId }),
          invoke<Source[]>('list_task_sources', { taskId }),
        ])
        const message = buildTaskContextMessage(task, sources)
        if (!message) {
          // Empty task — attach succeeded but nothing to inject. Show a
          // light note so the user understands why the chat didn't get
          // a new turn. `window.alert` is intentionally plain for now;
          // a proper toast lands with the next polish pass.
          console.info(
            `[tasks] attached "${task.name}" but it has no content to inject.`,
          )
          return
        }
        await sendUserMessage(message)
      } catch (e) {
        console.warn('[tasks] context injection failed', e)
      }
    },
    [sessionId, sessionBindings, sendUserMessage],
  )

  const detach = useCallback(
    async (taskId: string) => {
      await sessionBindings.detach(taskId)
    },
    [sessionBindings],
  )

  return { attach, detach }
}
