import { useCallback, useEffect, useRef } from 'react'
import { invoke } from '@tauri-apps/api/core'
import type { QaPair } from '../types'
import type { Source, Task } from '../types/task'
import { buildTaskContextMessage, TASK_CONTEXT_TOOL } from '../utils/taskContext'
import { logBackendError } from '../utils/log'

interface Options {
  pairs: QaPair[]
  turnInProgress: boolean
  sendUserMessage: (text: string) => Promise<void>
}

export interface UseTaskContextInjectFallbackResult {
  /** Register a task whose context-inject directive was just sent. */
  markPending: (taskId: string) => void
}

/**
 * Tool-first context injection with a prompt-injection fallback.
 *
 * `useTaskContextInject` sends a short directive asking the model to call
 * `load_task_context`. That's non-deterministic — the model might ignore it.
 * This hook watches the directive's own turn:
 *
 *  - if its assistant segments include a `load_task_context` tool_use, the
 *    context loaded as a visible tool call → nothing to do.
 *  - if the turn finishes (turnInProgress flips false) without that tool
 *    call, we fall back to the legacy behavior: inject the full Task
 *    markdown as a user turn.
 *
 * The directive turn is located by the `task_id="<id>"` marker its text
 * carries (see `buildTaskContextDirective`), so this is robust to queued
 * sends — the pair simply isn't found until the directive is actually
 * flushed and echoed.
 */
export function useTaskContextInjectFallback({
  pairs,
  turnInProgress,
  sendUserMessage,
}: Options): UseTaskContextInjectFallbackResult {
  // taskId -> still awaiting resolution. A ref (not state) so resolving an
  // entry never re-renders; the effect drives off `pairs`/`turnInProgress`.
  const pendingRef = useRef<Set<string>>(new Set())

  const markPending = useCallback((taskId: string) => {
    pendingRef.current.add(taskId)
  }, [])

  useEffect(() => {
    if (pendingRef.current.size === 0) return
    for (const taskId of Array.from(pendingRef.current)) {
      const marker = `task_id="${taskId}"`
      const pair = pairs.find((p) => p.user_text.includes(marker))
      // Directive not flushed/echoed yet (e.g. still queued) — wait.
      if (!pair) continue
      const calledTool = pair.segments.some(
        (s) => s.kind === 'tool_use' && s.name === TASK_CONTEXT_TOOL,
      )
      if (calledTool) {
        // Context arrived as a visible tool call — success, no fallback.
        pendingRef.current.delete(taskId)
        continue
      }
      // Tool not called. Only act once the directive's turn has fully ended;
      // turnInProgress is set synchronously when the directive flushes, so a
      // false reading here means the turn completed.
      if (turnInProgress) continue
      pendingRef.current.delete(taskId)
      void injectFallback(taskId, sendUserMessage)
    }
  }, [pairs, turnInProgress, sendUserMessage])

  return { markPending }
}

async function injectFallback(
  taskId: string,
  sendUserMessage: (text: string) => Promise<void>,
): Promise<void> {
  try {
    const [task, sources] = await Promise.all([
      invoke<Task>('get_task', { taskId }),
      invoke<Source[]>('list_task_sources', { taskId }),
    ])
    const message = buildTaskContextMessage(task, sources)
    if (message) await sendUserMessage(message)
  } catch (e) {
    logBackendError('tasks', 'context fallback injection', e)
  }
}
