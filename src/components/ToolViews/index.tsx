import {
  FilePath,
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
import {
  TodoWriteView,
  TaskCreateView,
  TaskUpdateView,
  AgentView,
} from './agentTools'
import './ToolViews.css'

// Re-exported for downstream consumers that import these names from the
// barrel (../ToolViews) rather than from the new _shared module.
export { FilePath }
export type { OpenFileFn, OpenFileOptions }

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
