import type { Source, Task } from '../types/task'
import { sourceTitle } from './sourceTitle'

/** Leading marker that tags an attach-time context-injection user turn. */
export const TASK_CONTEXT_PREFIX = '[Task 컨텍스트 주입: '

/**
 * Fully-qualified name of the in-app MCP tool (server `meecode`, tool
 * `load_task_context`) the CLI exposes once `--mcp-config` is wired up. The
 * fallback watcher matches assistant `tool_use` segments against this.
 */
export const TASK_CONTEXT_TOOL = 'mcp__meecode__load_task_context'

/**
 * Short directive user turn sent at attach time. Rather than dumping the
 * whole Task into the conversation, we ask the model to call
 * `load_task_context` so the bulky content arrives as a visible tool result.
 *
 * Starts with `TASK_CONTEXT_PREFIX` so `TaskContextNote` collapses it into a
 * chip, and embeds `task_id="<id>"` so the fallback watcher can locate this
 * exact turn and detect whether the tool was actually called.
 */
export function buildTaskAttachDirective(task: Task): string {
  return [
    `${TASK_CONTEXT_PREFIX}${task.name}]`,
    '',
    `이 세션에 Task "${task.name}"가 attach되었습니다. \`${TASK_CONTEXT_TOOL}\` 도구를 task_id="${task.id}" 인자로 호출해 이 Task의 description과 sources를 컨텍스트로 불러온 뒤, 한 줄로만 확인해 주세요.`,
  ].join('\n')
}

/**
 * Format a Task + its Sources as a markdown context-injection message.
 *
 * Sent verbatim as a user turn at attach time, so the LLM (and the
 * conversation history) absorbs the Task's content once and benefits
 * from prompt caching on subsequent turns. Phase 4 will swap the
 * source dump for the curated Wiki content.
 *
 * Returns `null` when the task has nothing to inject (no description,
 * no sources) — caller should still persist the binding but skip the
 * send so the chat doesn't get a useless empty turn.
 */
export function buildTaskContextMessage(
  task: Task,
  sources: Source[],
): string | null {
  const description = task.description.trim()
  if (!description && sources.length === 0) {
    return null
  }
  const lines: string[] = []
  lines.push(`${TASK_CONTEXT_PREFIX}${task.name}]`)
  lines.push('')
  lines.push(`# ${task.name}`)
  if (description) {
    lines.push('')
    lines.push(description)
  }
  if (sources.length > 0) {
    lines.push('')
    lines.push(`## Sources (${sources.length})`)
    sources.forEach((s, i) => {
      lines.push('')
      lines.push(`### [${i + 1}] ${sourceTitle(s)} · ${s.kind}`)
      lines.push(s.content)
    })
  }
  lines.push('')
  lines.push(
    '_위 내용은 이 세션에 attach된 Task의 컨텍스트입니다. 후속 대화에서 참고하세요._',
  )
  return lines.join('\n')
}

export interface ParsedTaskContext {
  taskName: string
  sourceCount: number
}

/**
 * Recognize an attach-time context-injection turn from its text and pull
 * out the task name + source count for a collapsed summary. Returns null
 * for ordinary user turns.
 */
export function parseTaskContextMessage(
  text: string,
): ParsedTaskContext | null {
  if (!text.startsWith(TASK_CONTEXT_PREFIX)) return null
  const end = text.indexOf(']', TASK_CONTEXT_PREFIX.length)
  if (end === -1) return null
  const taskName = text.slice(TASK_CONTEXT_PREFIX.length, end)
  const countMatch = text.match(/##\s*Sources\s*\((\d+)\)/)
  const sourceCount = countMatch ? Number(countMatch[1]) : 0
  return { taskName, sourceCount }
}
