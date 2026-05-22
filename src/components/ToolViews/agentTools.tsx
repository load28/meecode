import type { AssistantSegment } from '../../types'
import {
  ProgressBadge,
  pickArray,
  pickString,
  type ToolViewProps,
} from './_shared'
// Circular by design: SubagentSegment renders nested tool_use segments via
// the top-level dispatcher. The cycle is resolved at render time (after
// both module bindings exist), so it doesn't trip up bundlers.
import { ToolUseView } from './index'

interface Todo {
  content: string
  status: 'pending' | 'in_progress' | 'completed' | string
  activeForm?: string
}

export function TodoWriteView({ segment }: ToolViewProps) {
  const todos = pickArray(segment.input, 'todos') as Todo[]
  return (
    <div className="tool-view tool-view--todo">
      <header className="tool-view__header">
        <span className="tool-view__icon">☑</span>
        <span className="tool-view__name">TodoWrite</span>
        <span className="tool-view__hint">{todos.length}개</span>
      </header>
      <ul className="tool-view__todo-list">
        {todos.map((t, i) => (
          <li
            key={i}
            className={
              'tool-view__todo-item tool-view__todo-item--' +
              (t.status || 'pending')
            }
          >
            <span className="tool-view__todo-marker">
              {t.status === 'completed' ? '✔' : t.status === 'in_progress' ? '▶' : '○'}
            </span>
            <span className="tool-view__todo-text">
              {t.status === 'in_progress' && t.activeForm ? t.activeForm : t.content}
            </span>
          </li>
        ))}
      </ul>
    </div>
  )
}

export function TaskCreateView({ segment }: ToolViewProps) {
  const subject = pickString(segment.input, 'subject')
  const description = pickString(segment.input, 'description')
  const activeForm = pickString(segment.input, 'activeForm')
  return (
    <div className="tool-view tool-view--todo">
      <header className="tool-view__header">
        <span className="tool-view__icon">＋</span>
        <span className="tool-view__name">Task 추가</span>
        {activeForm && <span className="tool-view__hint">{activeForm}</span>}
      </header>
      {(subject || description) && (
        <div className="tool-view__todo-detail">
          {subject && <div className="tool-view__todo-subject">{subject}</div>}
          {description && (
            <div className="tool-view__todo-desc">{description}</div>
          )}
        </div>
      )}
    </div>
  )
}

export function TaskUpdateView({ segment }: ToolViewProps) {
  const taskId = pickString(segment.input, 'taskId')
  const status = pickString(segment.input, 'status')
  const subject = pickString(segment.input, 'subject')
  const description = pickString(segment.input, 'description')
  const marker =
    status === 'completed'
      ? '✔'
      : status === 'in_progress'
      ? '▶'
      : status === 'deleted'
      ? '✕'
      : '○'
  return (
    <div className="tool-view tool-view--todo">
      <header className="tool-view__header">
        <span className="tool-view__icon">{marker}</span>
        <span className="tool-view__name">Task 업데이트</span>
        {status && (
          <span
            className={`tool-view__hint tool-view__todo-status tool-view__todo-status--${status}`}
          >
            {status}
          </span>
        )}
        {taskId && (
          <span className="tool-view__hint">{taskId.slice(0, 8)}</span>
        )}
      </header>
      {(subject || description) && (
        <div className="tool-view__todo-detail">
          {subject && <div className="tool-view__todo-subject">{subject}</div>}
          {description && (
            <div className="tool-view__todo-desc">{description}</div>
          )}
        </div>
      )}
    </div>
  )
}

export function AgentView({ segment, onOpenFile, defaultOpen }: ToolViewProps) {
  const description = pickString(segment.input, 'description')
  const subagentType = pickString(segment.input, 'subagent_type')
  const prompt = pickString(segment.input, 'prompt')
  const children = segment.children ?? []
  return (
    <div className="tool-view tool-view--agent">
      <header className="tool-view__header">
        <span className="tool-view__icon">🤖</span>
        <span className="tool-view__name">Agent</span>
        {subagentType && <span className="tool-view__hint">{subagentType}</span>}
        <span className="tool-view__path">{description}</span>
        {children.length > 0 && (
          <span className="tool-view__hint">{children.length} steps</span>
        )}
        <ProgressBadge segment={segment} />
      </header>
      {prompt && (
        <details className="tool-view__diff" open={defaultOpen}>
          <summary className="tool-view__diff-summary">프롬프트 보기</summary>
          <pre className="tool-view__code">{prompt}</pre>
        </details>
      )}
      {children.length > 0 && (
        <details
          className="tool-view__subagent"
          open={defaultOpen ?? true}
        >
          <summary className="tool-view__subagent-summary">
            서브에이전트 활동 ({children.length})
          </summary>
          <SubagentTree entries={children} onOpenFile={onOpenFile} />
        </details>
      )}
    </div>
  )
}

/**
 * Render the nested activity stream the subagent emitted. Each entry
 * maps to one inner message (assistant or user). We reuse ToolUseView
 * for any inner tool_use segments — recursion is bounded by the
 * subagent depth in practice.
 */
function SubagentTree({
  entries,
  onOpenFile,
}: {
  entries: NonNullable<Extract<AssistantSegment, { kind: 'tool_use' }>['children']>
  onOpenFile?: (path: string) => void
}) {
  return (
    <div className="tool-view__subagent-tree">
      {entries.map((entry, i) => (
        <div
          key={i}
          className={`tool-view__subagent-entry tool-view__subagent-entry--${entry.role}`}
        >
          {entry.segments.map((seg, j) => (
            <SubagentSegment key={j} segment={seg} onOpenFile={onOpenFile} />
          ))}
        </div>
      ))}
    </div>
  )
}

function SubagentSegment({
  segment,
  onOpenFile,
}: {
  segment: AssistantSegment
  onOpenFile?: (path: string) => void
}) {
  // Avoid the full SegmentView (which imports this file) by handling the
  // most informative kinds inline. Text/thinking get a compact rendering;
  // tool_use reuses ToolUseView (recursion is safe because subagent
  // children are bounded by depth in practice).
  if (segment.kind === 'text') {
    return <div className="tool-view__subagent-text">{segment.text}</div>
  }
  if (segment.kind === 'thinking') {
    return (
      <div className="tool-view__subagent-thinking">
        💭 {segment.text}
      </div>
    )
  }
  if (segment.kind === 'tool_result') {
    return (
      <div
        className={
          segment.is_error
            ? 'tool-view__subagent-result tool-view__subagent-result--error'
            : 'tool-view__subagent-result'
        }
      >
        {segment.is_error ? '❌' : '✓'} {segment.text.slice(0, 240)}
      </div>
    )
  }
  if (segment.kind === 'tool_use') {
    return (
      <ToolUseView
        segment={segment}
        onOpenFile={onOpenFile}
        defaultOpen={false}
      />
    )
  }
  return null
}
