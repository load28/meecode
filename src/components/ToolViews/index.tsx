import type { AssistantSegment } from '../../types'
import './ToolViews.css'

interface ToolViewProps {
  segment: Extract<AssistantSegment, { kind: 'tool_use' }>
}

function pickString(input: unknown, key: string): string {
  if (!input || typeof input !== 'object') return ''
  const v = (input as Record<string, unknown>)[key]
  return typeof v === 'string' ? v : ''
}

function pickArray(input: unknown, key: string): unknown[] {
  if (!input || typeof input !== 'object') return []
  const v = (input as Record<string, unknown>)[key]
  return Array.isArray(v) ? v : []
}

function BashView({ segment }: ToolViewProps) {
  const command = pickString(segment.input, 'command')
  const description = pickString(segment.input, 'description')
  return (
    <div className="tool-view tool-view--bash">
      <header className="tool-view__header">
        <span className="tool-view__icon">⌘</span>
        <span className="tool-view__name">Bash</span>
        {description && (
          <span className="tool-view__hint">{description}</span>
        )}
      </header>
      <pre className="tool-view__code">{command || segment.summary}</pre>
    </div>
  )
}

function EditView({ segment }: ToolViewProps) {
  const filePath = pickString(segment.input, 'file_path')
  const oldStr = pickString(segment.input, 'old_string')
  const newStr = pickString(segment.input, 'new_string')
  return (
    <div className="tool-view tool-view--edit">
      <header className="tool-view__header">
        <span className="tool-view__icon">✎</span>
        <span className="tool-view__name">Edit</span>
        <span className="tool-view__path">{filePath}</span>
      </header>
      {(oldStr || newStr) && (
        <details className="tool-view__diff">
          <summary className="tool-view__diff-summary">변경 보기</summary>
          {oldStr && (
            <pre className="tool-view__diff-old">
              {oldStr.split('\n').map((l, i) => (
                <div key={`o-${i}`}>- {l}</div>
              ))}
            </pre>
          )}
          {newStr && (
            <pre className="tool-view__diff-new">
              {newStr.split('\n').map((l, i) => (
                <div key={`n-${i}`}>+ {l}</div>
              ))}
            </pre>
          )}
        </details>
      )}
    </div>
  )
}

function WriteView({ segment }: ToolViewProps) {
  const filePath = pickString(segment.input, 'file_path')
  const content = pickString(segment.input, 'content')
  const lineCount = content ? content.split('\n').length : 0
  return (
    <div className="tool-view tool-view--write">
      <header className="tool-view__header">
        <span className="tool-view__icon">＋</span>
        <span className="tool-view__name">Write</span>
        <span className="tool-view__path">{filePath}</span>
        {lineCount > 0 && (
          <span className="tool-view__hint">{lineCount} lines</span>
        )}
      </header>
      {content && (
        <details className="tool-view__diff">
          <summary className="tool-view__diff-summary">내용 보기</summary>
          <pre className="tool-view__code">{content}</pre>
        </details>
      )}
    </div>
  )
}

function ReadView({ segment }: ToolViewProps) {
  const filePath = pickString(segment.input, 'file_path')
  const offset = (segment.input as Record<string, unknown> | null)?.offset
  const limit = (segment.input as Record<string, unknown> | null)?.limit
  return (
    <div className="tool-view tool-view--read">
      <header className="tool-view__header">
        <span className="tool-view__icon">👁</span>
        <span className="tool-view__name">Read</span>
        <span className="tool-view__path">{filePath}</span>
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

function AgentView({ segment }: ToolViewProps) {
  const description = pickString(segment.input, 'description')
  const subagentType = pickString(segment.input, 'subagent_type')
  const prompt = pickString(segment.input, 'prompt')
  return (
    <div className="tool-view tool-view--agent">
      <header className="tool-view__header">
        <span className="tool-view__icon">🤖</span>
        <span className="tool-view__name">Agent</span>
        {subagentType && <span className="tool-view__hint">{subagentType}</span>}
        <span className="tool-view__path">{description}</span>
      </header>
      {prompt && (
        <details className="tool-view__diff">
          <summary className="tool-view__diff-summary">프롬프트 보기</summary>
          <pre className="tool-view__code">{prompt}</pre>
        </details>
      )}
    </div>
  )
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

function GenericToolView({ segment }: ToolViewProps) {
  return (
    <details className="tool-view tool-view--generic">
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

export function ToolUseView({ segment }: ToolViewProps) {
  switch (segment.name) {
    case 'Bash':
      return <BashView segment={segment} />
    case 'Edit':
    case 'MultiEdit':
      return <EditView segment={segment} />
    case 'Write':
      return <WriteView segment={segment} />
    case 'Read':
      return <ReadView segment={segment} />
    case 'TodoWrite':
      return <TodoWriteView segment={segment} />
    case 'Grep':
    case 'Glob':
      return <GrepGlobView segment={segment} />
    case 'WebFetch':
    case 'WebSearch':
      return <WebView segment={segment} />
    case 'Skill':
      return <SkillView segment={segment} />
    case 'Agent':
      return <AgentView segment={segment} />
    case 'ToolSearch':
      return <ToolSearchView segment={segment} />
    default:
      return <GenericToolView segment={segment} />
  }
}
