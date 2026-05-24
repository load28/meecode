import { useMemo } from 'react'
import { MainHeader } from './MainHeader'
import { MainBanners } from './MainBanners'
import { MainBody } from './MainBody'
import { TaskPicker } from '../TaskPicker'
import { useFileTabs, type PendingEdit } from '../../hooks/useFileTabs'
import { useDetachedFilePanel } from '../../hooks/useDetachedFilePanel'
import { useTasks } from '../../hooks/useTasks'
import { useSessionBindings } from '../../hooks/useSessionBindings'
import { useTaskAttach } from '../../hooks/useTaskAttach'
import { usePendingSelection } from '../../hooks/usePendingSelection'
import { useClaudeSession } from '../../hooks/useClaudeSession'
import { useExpandPanel } from '../../hooks/useExpandPanel'
import { useSessionSwitchOnMount } from '../../hooks/useSessionSwitchOnMount'
import { useSyncEffect } from '../../hooks/useSyncEffect'
import { useCapturePicker } from '../../hooks/useCapturePicker'
import { useExpandedPair } from '../../hooks/useExpandedPair'

export interface MainLayoutProps {
  tabId: string
  projectPath: string
  pendingSessionId: string | null
  needsSwitch: boolean
  onSwitchProject: (path: string) => void
  onSwitchSession: (sessionId: string | null) => void
  onSessionTitleChange: (title: string | null) => void
  claudeReady: boolean
  onOpenSettings: () => void
  showTasks: boolean
  onToggleTasks: () => void
  showExplorer: boolean
  onToggleExplorer: () => void
  /**
   * Whether this tab is the active one. Hidden tabs unsubscribe from the
   * session store so streaming chunks don't trigger re-renders / markdown
   * re-parses / typewriter rAF loops behind the scenes. State stays current
   * (listeners are module-level); re-subscription happens automatically on
   * the next render after this flips back to true.
   */
  visible: boolean
}

export function MainLayout({
  tabId,
  projectPath,
  pendingSessionId,
  needsSwitch,
  onSwitchProject,
  onSwitchSession,
  onSessionTitleChange,
  claudeReady,
  onOpenSettings,
  showTasks,
  onToggleTasks,
  showExplorer,
  onToggleExplorer,
  visible,
}: MainLayoutProps) {
  const claude = useClaudeSession(tabId, visible)
  const {
    pairs,
    hookActivity,
    rateLimit,
    turnError,
    dismissRateLimit,
    model,
    usage,
    setModel,
    sessionId,
    cwd,
    mcpServers,
    agents,
    tools,
    sendUserMessage,
    sessionTitle,
  } = claude
  const { tasks } = useTasks()
  const sessionBindings = useSessionBindings(sessionId)
  const attachedTaskIds = useMemo(
    () => new Set(sessionBindings.bindings.map((b) => b.task_id)),
    [sessionBindings.bindings],
  )

  useSyncEffect(onSessionTitleChange, sessionTitle)
  useSessionSwitchOnMount({ tabId, projectPath, pendingSessionId, needsSwitch })

  // composer의 ArrowUp/Down 히스토리에 보여줄 최근 사용자 메시지 갯수.
  // 너무 길면 페이징이 번거롭고, 너무 짧으면 한 세션 안에서 자주 잘린다.
  const HISTORY_TAIL_SIZE = 20
  const recentUserTexts = useMemo(() => {
    return pairs
      .map((p) => p.user_text)
      .filter((t) => !!t && !t.startsWith('──'))
      .slice(-HISTORY_TAIL_SIZE)
  }, [pairs])
  const {
    expandedId,
    setExpandedId,
    isOpen,
    toggleOpen,
    autoExpand,
    setAutoExpand,
  } = useExpandPanel(pairs)

  const fileTabs = useFileTabs()
  const { isDetached, detach, openFile, openContent } =
    useDetachedFilePanel(fileTabs)
  // Selection captured from a Q&A card, the expand pane, or a file panel,
  // forwarded to the composer where it becomes an inline `[코멘트 #N]`
  // placeholder. `source` is set when the selection came from the file
  // panel (so the expanded block can carry a `// path:lines` header).
  const selection = usePendingSelection()
  // QaCard's capture button / CommentFloat's 📥 button drive this hook;
  // TaskPicker (mounted below) reads `draft` to know when to open.
  const capture = useCapturePicker({ sessionId, projectPath })

  const taskAttach = useTaskAttach({
    sessionId,
    sessionBindings,
    sendUserMessage,
  })

  const handleOpenFile = (
    path: string,
    opts?: { pending?: PendingEdit | null },
  ) => {
    openFile(path, opts)
  }
  const expanded = useExpandedPair({
    pairs,
    expandedId,
    setExpandedId,
    isOpen,
    toggleOpen,
  })

  return (
    <div className="app">
      <MainHeader
        projectPath={projectPath}
        sessionId={sessionId}
        cwd={cwd}
        mcpServers={mcpServers}
        agents={agents}
        tools={tools}
        model={model}
        usage={usage}
        showTasks={showTasks}
        tasksCount={tasks.length}
        attachedTasksCount={attachedTaskIds.size}
        showExplorer={showExplorer}
        onToggleExplorer={onToggleExplorer}
        isExpandOpen={isOpen}
        hasExpanded={expandedId !== null}
        autoExpand={autoExpand}
        onSwitchProject={onSwitchProject}
        onSwitchSession={onSwitchSession}
        onToggleExpandOpen={toggleOpen}
        onToggleTasks={onToggleTasks}
        onAutoExpandChange={setAutoExpand}
        onModelChange={(m) => {
          setModel(m).catch(() => {})
        }}
        onOpenSettings={onOpenSettings}
      />
      <MainBanners
        hookActivity={hookActivity}
        rateLimit={rateLimit}
        turnError={turnError}
        onDismissRateLimit={dismissRateLimit}
      />
      <MainBody
        tabId={tabId}
        projectPath={projectPath}
        claudeReady={claudeReady}
        claude={claude}
        fileTabs={fileTabs}
        recentUserTexts={recentUserTexts}
        expandedPair={expanded.pair}
        isExpandOpen={isOpen}
        onToggleExpand={toggleOpen}
        isDetached={isDetached}
        onDetachFilePanel={() => {
          void detach()
        }}
        selection={selection}
        onCapture={capture.open}
        onExpand={expanded.expand}
        onOpenFile={handleOpenFile}
        onOpenSettings={onOpenSettings}
        showTasks={showTasks}
        onToggleTasks={onToggleTasks}
        showExplorer={showExplorer}
        sessionId={sessionId}
        attachedTaskIds={attachedTaskIds}
        onAttachTask={taskAttach.attach}
        onDetachTask={taskAttach.detach}
        onOpenContent={openContent}
      />
      {capture.draft && (
        <TaskPicker draft={capture.draft} onClose={capture.close} />
      )}
    </div>
  )
}
