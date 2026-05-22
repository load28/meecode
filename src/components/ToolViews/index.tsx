import type { AssistantSegment } from '../../types'
import {
  FilePath,
  ProgressBadge,
  pickArray,
  pickString,
  type OpenFileFn,
  type OpenFileOptions,
  type ToolViewProps,
} from './_shared'
import { BashView, BashOutputView, KillBashView } from './bashTools'
import {
  EditView,
  MultiEditView,
  WriteView,
  ReadView,
  NotebookEditView,
} from './fileTools'
import './ToolViews.css'

// Re-exported for downstream consumers that import these names from the
// barrel (../ToolViews) rather than from the new _shared module.
export { FilePath }
export type { OpenFileFn, OpenFileOptions }

interface Todo {
  content: string
  status: 'pending' | 'in_progress' | 'completed' | string
  activeForm?: string
}

function TodoWriteView({ segment }: ToolViewProps) {
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

function TaskCreateView({ segment }: ToolViewProps) {
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

function TaskUpdateView({ segment }: ToolViewProps) {
  const taskId = pickString(segment.input, 'taskId')
  const status = pickString(segment.input, 'status')
  const subject = pickString(segment.input, 'subject')
  const description = pickString(segment.input, 'description')
  const marker =
    status === 'completed' ? '✔' : status === 'in_progress' ? '▶' : status === 'deleted' ? '✕' : '○'
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

function GrepGlobView({ segment }: ToolViewProps) {
  const pattern = pickString(segment.input, 'pattern')
  const path = pickString(segment.input, 'path')
  const glob = pickString(segment.input, 'glob')
  return (
    <div className="tool-view tool-view--search">
      <header className="tool-view__header">
        <span className="tool-view__icon">🔎</span>
        <span className="tool-view__name">{segment.name}</span>
        <span className="tool-view__pattern">{pattern}</span>
        {(path || glob) && (
          <span className="tool-view__hint">
            {path && <>in <code>{path}</code></>}
            {path && glob && ' · '}
            {glob && <code>{glob}</code>}
          </span>
        )}
      </header>
    </div>
  )
}

function WebView({ segment }: ToolViewProps) {
  const url = pickString(segment.input, 'url')
  const query = pickString(segment.input, 'query')
  const prompt = pickString(segment.input, 'prompt')
  return (
    <div className="tool-view tool-view--web">
      <header className="tool-view__header">
        <span className="tool-view__icon">🌐</span>
        <span className="tool-view__name">{segment.name}</span>
        <span className="tool-view__path">{url || query}</span>
      </header>
      {prompt && <pre className="tool-view__code">{prompt}</pre>}
    </div>
  )
}

function SkillView({ segment }: ToolViewProps) {
  const skill = pickString(segment.input, 'skill')
  const args = pickString(segment.input, 'args')
  return (
    <div className="tool-view tool-view--skill">
      <header className="tool-view__header">
        <span className="tool-view__icon">🎯</span>
        <span className="tool-view__name">Skill</span>
        <span className="tool-view__path">{skill}</span>
        {args && <span className="tool-view__hint">{args}</span>}
      </header>
    </div>
  )
}

function AgentView({ segment, onOpenFile, defaultOpen }: ToolViewProps) {
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
 * Render the nested activity stream the subagent emitted. Each entry maps to
 * one inner message (assistant or user). We reuse the same SegmentView via a
 * lightweight lazy import to avoid the circular dep with MessageBubble.
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
            <SubagentSegment
              key={j}
              segment={seg}
              onOpenFile={onOpenFile}
            />
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
      <ToolUseView segment={segment} onOpenFile={onOpenFile} defaultOpen={false} />
    )
  }
  return null
}

function ToolSearchView({ segment }: ToolViewProps) {
  const query = pickString(segment.input, 'query')
  return (
    <div className="tool-view tool-view--search">
      <header className="tool-view__header">
        <span className="tool-view__icon">🔧</span>
        <span className="tool-view__name">ToolSearch</span>
        <span className="tool-view__pattern">{query}</span>
      </header>
    </div>
  )
}

function SlashCommandView({ segment }: ToolViewProps) {
  const command = pickString(segment.input, 'command')
  return (
    <div className="tool-view tool-view--skill">
      <header className="tool-view__header">
        <span className="tool-view__icon">/</span>
        <span className="tool-view__name">SlashCommand</span>
        <span className="tool-view__path">{command}</span>
      </header>
    </div>
  )
}

function GenericToolView({ segment, defaultOpen }: ToolViewProps) {
  return (
    <details className="tool-view tool-view--generic" open={defaultOpen}>
      <summary className="tool-view__generic-summary">
        <span className="tool-view__name">{segment.name}</span>
        {segment.summary && (
          <span className="tool-view__hint">{segment.summary}</span>
        )}
      </summary>
      <pre className="tool-view__code">
        {JSON.stringify(segment.input, null, 2)}
      </pre>
    </details>
  )
}

export function ToolUseView({ segment, onOpenFile, defaultOpen }: ToolViewProps) {
  switch (segment.name) {
    case 'Bash':
      return <BashView segment={segment} />
    case 'Edit':
      return (
        <EditView segment={segment} onOpenFile={onOpenFile} defaultOpen={defaultOpen} />
      )
    case 'MultiEdit':
      return (
        <MultiEditView
          segment={segment}
          onOpenFile={onOpenFile}
          defaultOpen={defaultOpen}
        />
      )
    case 'Write':
      return (
        <WriteView segment={segment} onOpenFile={onOpenFile} defaultOpen={defaultOpen} />
      )
    case 'Read':
      return <ReadView segment={segment} onOpenFile={onOpenFile} />
    case 'TodoWrite':
      return <TodoWriteView segment={segment} />
    case 'TaskCreate':
      return <TaskCreateView segment={segment} />
    case 'TaskUpdate':
      return <TaskUpdateView segment={segment} />
    case 'Grep':
    case 'Glob':
      return <GrepGlobView segment={segment} />
    case 'WebFetch':
    case 'WebSearch':
      return <WebView segment={segment} />
    case 'Skill':
      return <SkillView segment={segment} />
    case 'Agent':
      return <AgentView segment={segment} defaultOpen={defaultOpen} />
    case 'ToolSearch':
      return <ToolSearchView segment={segment} />
    case 'NotebookEdit':
      return <NotebookEditView segment={segment} defaultOpen={defaultOpen} />
    case 'BashOutput':
      return <BashOutputView segment={segment} />
    case 'KillBash':
    case 'KillShell':
      return <KillBashView segment={segment} />
    case 'SlashCommand':
      return <SlashCommandView segment={segment} />
    default:
      return <GenericToolView segment={segment} defaultOpen={defaultOpen} />
  }
}
