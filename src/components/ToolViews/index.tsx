import type { AssistantSegment } from '../../types'
import { DiffView } from '../DiffView'
import {
  FilePath,
  ProgressBadge,
  pickArray,
  pickString,
  withPending,
  type OpenFileFn,
  type OpenFileOptions,
  type ToolViewProps,
} from './_shared'
import './ToolViews.css'

// Re-exported for downstream consumers that import these names from the
// barrel (../ToolViews) rather than from the new _shared module.
export { FilePath }
export type { OpenFileFn, OpenFileOptions }

function BashView({ segment }: ToolViewProps) {
  const command = pickString(segment.input, 'command')
  const description = pickString(segment.input, 'description')
  const body = command || segment.summary
  return (
    <div className="tool-view tool-view--bash">
      <header className="tool-view__header">
        <span className="tool-view__icon">⌘</span>
        <span className="tool-view__name">Bash</span>
        {description && (
          <span className="tool-view__hint">{description}</span>
        )}
        <ProgressBadge segment={segment} />
      </header>
      {/* Skip the empty pre when streaming hasn't filled `input.command`
          yet — otherwise the card renders a blank black box. */}
      {body && <pre className="tool-view__code">{body}</pre>}
    </div>
  )
}

function EditView({ segment, onOpenFile, defaultOpen }: ToolViewProps) {
  const filePath = pickString(segment.input, 'file_path')
  const oldStr = pickString(segment.input, 'old_string')
  const newStr = pickString(segment.input, 'new_string')
  const openWithDiff = withPending(onOpenFile, {
    kind: 'edit',
    oldText: oldStr,
    newText: newStr,
  })
  return (
    <div className="tool-view tool-view--edit">
      <header className="tool-view__header">
        <span className="tool-view__icon">✎</span>
        <span className="tool-view__name">Edit</span>
        <FilePath path={filePath} onOpen={openWithDiff} />
      </header>
      {(oldStr || newStr) && (
        <DiffView
          oldText={oldStr}
          newText={newStr}
          defaultOpen={defaultOpen}
          collapsibleLabel="변경 보기"
        />
      )}
    </div>
  )
}

function MultiEditView({ segment, onOpenFile, defaultOpen }: ToolViewProps) {
  const filePath = pickString(segment.input, 'file_path')
  const edits = pickArray(segment.input, 'edits') as Array<{
    old_string?: string
    new_string?: string
  }>
  const openWithDiff = withPending(onOpenFile, {
    kind: 'multiedit',
    oldText: edits
      .map((e) => (typeof e.old_string === 'string' ? e.old_string : ''))
      .join('\n'),
    newText: edits
      .map((e) => (typeof e.new_string === 'string' ? e.new_string : ''))
      .join('\n'),
    label: `${edits.length}개 변경`,
  })
  return (
    <div className="tool-view tool-view--edit">
      <header className="tool-view__header">
        <span className="tool-view__icon">✎</span>
        <span className="tool-view__name">MultiEdit</span>
        <FilePath path={filePath} onOpen={openWithDiff} />
        {edits.length > 0 && (
          <span className="tool-view__hint">{edits.length}개 변경</span>
        )}
      </header>
      {edits.map((e, i) => (
        <DiffView
          key={i}
          oldText={typeof e.old_string === 'string' ? e.old_string : ''}
          newText={typeof e.new_string === 'string' ? e.new_string : ''}
          defaultOpen={defaultOpen}
          collapsibleLabel={`변경 ${i + 1}`}
        />
      ))}
    </div>
  )
}

function WriteView({ segment, onOpenFile, defaultOpen }: ToolViewProps) {
  const filePath = pickString(segment.input, 'file_path')
  const content = pickString(segment.input, 'content')
  const lineCount = content ? content.split('\n').length : 0
  const openWithDiff = withPending(onOpenFile, {
    kind: 'write',
    oldText: '',
    newText: content,
  })
  return (
    <div className="tool-view tool-view--write">
      <header className="tool-view__header">
        <span className="tool-view__icon">＋</span>
        <span className="tool-view__name">Write</span>
        <FilePath path={filePath} onOpen={openWithDiff} />
        {lineCount > 0 && (
          <span className="tool-view__hint">{lineCount} lines</span>
        )}
      </header>
      {content && (
        <DiffView
          oldText=""
          newText={content}
          defaultOpen={defaultOpen}
          collapsibleLabel="내용 보기"
        />
      )}
    </div>
  )
}

function ReadView({ segment, onOpenFile }: ToolViewProps) {
  const filePath = pickString(segment.input, 'file_path')
  const offset = (segment.input as Record<string, unknown> | null)?.offset
  const limit = (segment.input as Record<string, unknown> | null)?.limit
  return (
    <div className="tool-view tool-view--read">
      <header className="tool-view__header">
        <span className="tool-view__icon">👁</span>
        <span className="tool-view__name">Read</span>
        <FilePath path={filePath} onOpen={onOpenFile} />
        {(typeof offset === 'number' || typeof limit === 'number') && (
          <span className="tool-view__hint">
            {typeof offset === 'number' ? `+${offset}` : ''}
            {typeof limit === 'number' ? ` ×${limit}` : ''}
          </span>
        )}
      </header>
    </div>
  )
}

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

function NotebookEditView({ segment, defaultOpen }: ToolViewProps) {
  const path = pickString(segment.input, 'notebook_path')
  const cellId = pickString(segment.input, 'cell_id')
  const editMode = pickString(segment.input, 'edit_mode') || 'replace'
  const newSource = pickString(segment.input, 'new_source')
  return (
    <div className="tool-view tool-view--edit">
      <header className="tool-view__header">
        <span className="tool-view__icon">📓</span>
        <span className="tool-view__name">NotebookEdit</span>
        <span className="tool-view__path">{path}</span>
        <span className="tool-view__hint">
          {editMode}
          {cellId && ` · ${cellId.slice(0, 8)}`}
        </span>
      </header>
      {newSource && (
        <details className="tool-view__diff" open={defaultOpen}>
          <summary className="tool-view__diff-summary">셀 내용 보기</summary>
          <pre className="tool-view__code">{newSource}</pre>
        </details>
      )}
    </div>
  )
}

function BashOutputView({ segment }: ToolViewProps) {
  const bashId = pickString(segment.input, 'bash_id')
  const filter = pickString(segment.input, 'filter')
  return (
    <div className="tool-view tool-view--bash">
      <header className="tool-view__header">
        <span className="tool-view__icon">⏳</span>
        <span className="tool-view__name">BashOutput</span>
        <span className="tool-view__path">{bashId}</span>
        {filter && <span className="tool-view__hint">filter: {filter}</span>}
      </header>
    </div>
  )
}

function KillBashView({ segment }: ToolViewProps) {
  const bashId = pickString(segment.input, 'shell_id') || pickString(segment.input, 'bash_id')
  return (
    <div className="tool-view tool-view--bash">
      <header className="tool-view__header">
        <span className="tool-view__icon">⛔</span>
        <span className="tool-view__name">KillBash</span>
        <span className="tool-view__path">{bashId}</span>
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
