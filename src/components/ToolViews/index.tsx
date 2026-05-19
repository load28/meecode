import { invoke } from '@tauri-apps/api/core'
import type { AssistantSegment } from '../../types'
import './ToolViews.css'

function openExternal(path: string) {
  invoke('open_external', { path }).catch((e) =>
    console.warn('[meecode] open_external failed', e),
  )
}

function FilePath({
  path,
  onOpen,
}: {
  path: string
  onOpen?: (path: string) => void
}) {
  if (!path) return null
  return (
    <button
      type="button"
      className="tool-view__path tool-view__path-link"
      onClick={() => {
        if (onOpen) onOpen(path)
        else openExternal(path)
      }}
      title={onOpen ? '파일 패널에서 열기' : '외부 편집기에서 열기'}
    >
      {path}
    </button>
  )
}

interface ToolViewProps {
  segment: Extract<AssistantSegment, { kind: 'tool_use' }>
  onOpenFile?: (path: string) => void
  defaultOpen?: boolean
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
  const body = command || segment.summary
  return (
    <div className="tool-view tool-view--bash">
      <header className="tool-view__header">
        <span className="tool-view__icon">⌘</span>
        <span className="tool-view__name">Bash</span>
        {description && (
          <span className="tool-view__hint">{description}</span>
        )}
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
  return (
    <div className="tool-view tool-view--edit">
      <header className="tool-view__header">
        <span className="tool-view__icon">✎</span>
        <span className="tool-view__name">Edit</span>
        <FilePath path={filePath} onOpen={onOpenFile} />
      </header>
      {(oldStr || newStr) && (
        <details className="tool-view__diff" open={defaultOpen}>
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

function WriteView({ segment, onOpenFile, defaultOpen }: ToolViewProps) {
  const filePath = pickString(segment.input, 'file_path')
  const content = pickString(segment.input, 'content')
  const lineCount = content ? content.split('\n').length : 0
  return (
    <div className="tool-view tool-view--write">
      <header className="tool-view__header">
        <span className="tool-view__icon">＋</span>
        <span className="tool-view__name">Write</span>
        <FilePath path={filePath} onOpen={onOpenFile} />
        {lineCount > 0 && (
          <span className="tool-view__hint">{lineCount} lines</span>
        )}
      </header>
      {content && (
        <details className="tool-view__diff" open={defaultOpen}>
          <summary className="tool-view__diff-summary">내용 보기</summary>
          <pre className="tool-view__code">{content}</pre>
        </details>
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

function AgentView({ segment, defaultOpen }: ToolViewProps) {
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
        <details className="tool-view__diff" open={defaultOpen}>
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
    case 'MultiEdit':
      return (
        <EditView segment={segment} onOpenFile={onOpenFile} defaultOpen={defaultOpen} />
      )
    case 'Write':
      return (
        <WriteView segment={segment} onOpenFile={onOpenFile} defaultOpen={defaultOpen} />
      )
    case 'Read':
      return <ReadView segment={segment} onOpenFile={onOpenFile} />
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
