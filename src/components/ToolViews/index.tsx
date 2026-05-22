import {
  FilePath,
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
import {
  GrepGlobView,
  WebView,
  SkillView,
  ToolSearchView,
  SlashCommandView,
  GenericToolView,
} from './miscTools'
import './ToolViews.css'

// Re-exported for downstream consumers that import these names from the
// barrel (../ToolViews) rather than from the new _shared module.
export { FilePath }
export type { OpenFileFn, OpenFileOptions }

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
