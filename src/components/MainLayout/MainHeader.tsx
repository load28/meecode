import { ProjectSwitcher } from '../ProjectSwitcher'
import { SessionSwitcher } from '../SessionSwitcher'
import { SessionInfoBar } from '../SessionInfoBar'
import { UsageChip } from './UsageChip'
import type {
  AgentInfo,
  McpServerInfo,
  UsageStats,
} from '../../hooks/useClaudeSession'

interface Props {
  projectPath: string
  sessionId: string | null
  cwd: string | null
  mcpServers: McpServerInfo[]
  agents: AgentInfo[]
  tools: string[]
  model: string | null
  usage: UsageStats
  showTasks: boolean
  tasksCount: number
  attachedTasksCount: number
  showExplorer: boolean
  onToggleExplorer: () => void
  isExpandOpen: boolean
  hasExpanded: boolean
  autoExpand: boolean
  onSwitchProject: (path: string) => void
  onSwitchSession: (sessionId: string | null) => void
  onToggleExpandOpen: () => void
  onToggleTasks: () => void
  onAutoExpandChange: (next: boolean) => void
  onModelChange: (model: string | null) => void
  onOpenSettings: () => void
}

/**
 * Top-of-window control strip: project / session switchers, panel toggles,
 * usage chip, info bar, model picker, settings. Pure render — every piece
 * of state and every callback is provided by the parent.
 */
export function MainHeader({
  projectPath,
  sessionId,
  cwd,
  mcpServers,
  agents,
  tools,
  model,
  usage,
  showTasks,
  tasksCount,
  attachedTasksCount,
  showExplorer,
  onToggleExplorer,
  isExpandOpen,
  hasExpanded,
  autoExpand,
  onSwitchProject,
  onSwitchSession,
  onToggleExpandOpen,
  onToggleTasks,
  onAutoExpandChange,
  onModelChange,
  onOpenSettings,
}: Props) {
  return (
    <div className="app__header">
      <ProjectSwitcher currentPath={projectPath} onSwitch={onSwitchProject} />
      <SessionSwitcher
        projectPath={projectPath}
        currentSessionId={sessionId}
        onSwitch={onSwitchSession}
      />
      {!isExpandOpen && hasExpanded && (
        <button
          type="button"
          className="app__reopen-btn"
          aria-label="펼쳐보기 패널 열기"
          onClick={onToggleExpandOpen}
        >
          ◀ 패널 열기
        </button>
      )}
      <button
        type="button"
        className={`app__knowledge-btn${showExplorer ? ' is-active' : ''}`}
        onClick={onToggleExplorer}
        title="파일 탐색기"
      >
        🗂 탐색기
      </button>
      <button
        type="button"
        className={`app__knowledge-btn${showTasks ? ' is-active' : ''}`}
        onClick={onToggleTasks}
        title={
          attachedTasksCount > 0
            ? `Tasks (${tasksCount}개 · ${attachedTasksCount}개 attach됨)`
            : `Tasks (${tasksCount}개)`
        }
      >
        📋 Tasks ({tasksCount})
        {attachedTasksCount > 0 && (
          <span className="app__attached-count">
            📎 {attachedTasksCount}
          </span>
        )}
      </button>
      <label className="app__auto-toggle">
        <input
          type="checkbox"
          checked={autoExpand}
          onChange={(e) => onAutoExpandChange(e.target.checked)}
        />
        긴 답변 자동 펼침
      </label>
      <UsageChip usage={usage} />
      <SessionInfoBar
        sessionId={sessionId}
        cwd={cwd}
        mcpServers={mcpServers}
        agents={agents}
        tools={tools}
      />
      <select
        className="app__model-picker"
        value={model ?? ''}
        onChange={(e) => {
          const v = e.target.value
          onModelChange(v === '' ? null : v)
        }}
        title="모델 선택"
      >
        <option value="">기본</option>
        <option value="claude-opus-4-7">Opus 4.7</option>
        <option value="claude-sonnet-4-6">Sonnet 4.6</option>
        <option value="claude-haiku-4-5-20251001">Haiku 4.5</option>
      </select>
      <button
        type="button"
        className="app__settings-btn"
        onClick={onOpenSettings}
        title="설정"
        aria-label="설정"
      >
        ⚙
      </button>
    </div>
  )
}
