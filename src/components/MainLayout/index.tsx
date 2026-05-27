import { useEffect, useMemo } from 'react'
import { MainHeader } from './MainHeader'
import { MainBanners } from './MainBanners'
import { MainBody } from './MainBody'
import { TaskPicker } from '../TaskPicker'
import { useFileTabs, type PendingEdit } from '../../hooks/useFileTabs'
import { isDescendantOrSelf } from '../FileExplorer/paths'
import { useDetachedFilePanel } from '../../hooks/useDetachedFilePanel'
import { useTasks } from '../../hooks/useTasks'
import { useTaskContextInject } from '../../hooks/useTaskContextInject'
import { useTaskContextInjectFallback } from '../../hooks/useTaskContextInjectFallback'
import { usePendingSelection } from '../../hooks/usePendingSelection'
import { useClaudeSession } from '../../hooks/useClaudeSession'
import { useExpandPanel } from '../../hooks/useExpandPanel'
import { useSessionLifecycle } from '../../hooks/useSessionLifecycle'
import { useSyncEffect } from '../../hooks/useSyncEffect'
import { useCapturePicker } from '../../hooks/useCapturePicker'
import { useExpandedPair } from '../../hooks/useExpandedPair'
import { setWorkspaceRoot } from '../../editor/lsp/workspace'
import { setEditorOpenHandler } from '../../editor/navigation'

export interface MainLayoutProps {
  tabId: string
  projectPath: string
  pendingSessionId: string | null
  /** Bumped by useTabs when this tab needs a (re)spawn; drives the lifecycle. */
  switchSeq: number
  /** Marks the tab live once its backend process has spawned. */
  onSpawned: (tabId: string) => void
  onSwitchProject: (path: string) => void
  onSwitchSession: (sessionId: string | null) => void
  onSessionTitleChange: (title: string | null) => void
  claudeReady: boolean
  onOpenSettings: () => void
  showTasks: boolean
  onToggleTasks: () => void
  showExplorer: boolean
  onToggleExplorer: () => void
}

export function MainLayout({
  tabId,
  projectPath,
  pendingSessionId,
  switchSeq,
  onSpawned,
  onSwitchProject,
  onSwitchSession,
  onSessionTitleChange,
  claudeReady,
  onOpenSettings,
  showTasks,
  onToggleTasks,
  showExplorer,
  onToggleExplorer,
}: MainLayoutProps) {
  const claude = useClaudeSession(tabId)
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
    turnInProgress,
  } = claude
  const { tasks } = useTasks()

  useSyncEffect(onSessionTitleChange, sessionTitle)
  // Track the active project as the LSP workspace root so servers index the
  // right tree. (Per-window single root; matches the active tab's project.)
  useEffect(() => setWorkspaceRoot(projectPath), [projectPath])
  useSessionLifecycle({
    tabId,
    projectPath,
    pendingSessionId,
    switchSeq,
    onSpawned,
  })

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
  } = useExpandPanel(tabId, pairs)

  const fileTabs = useFileTabs(tabId)
  const { isDetached, detach, openFile, openContent, auxContainer } =
    useDetachedFilePanel(fileTabs)

  // Cross-file definition/reference jumps route to the single shared editor.
  // Detaching only relocates the panel (window.open shares the renderer), so
  // the same handler/tabs apply whether the panel is inline or in the aux window.
  const { open: openTab, setActive: setActiveTab } = fileTabs
  useEffect(() => {
    setEditorOpenHandler((path) => {
      void openTab(path)
      setActiveTab(path)
    })
    return () => setEditorOpenHandler(null)
  }, [openTab, setActiveTab])
  // Selection captured from a Q&A card, the expand pane, or a file panel,
  // forwarded to the composer where it becomes an inline `[코멘트 #N]`
  // placeholder. `source` is set when the selection came from the file
  // panel (so the expanded block can carry a `// path:lines` header).
  const selection = usePendingSelection(tabId)
  // QaCard's capture button / CommentFloat's 📥 button drive this hook;
  // TaskPicker (mounted below) reads `draft` to know when to open.
  const capture = useCapturePicker({ tabId, sessionId, projectPath })

  const taskFallback = useTaskContextInjectFallback({
    pairs,
    turnInProgress,
    sendUserMessage,
  })
  const taskInject = useTaskContextInject({
    sessionId,
    sendUserMessage,
    onDirectiveSent: taskFallback.markPending,
  })

  const handleOpenFile = (
    path: string,
    opts?: { pending?: PendingEdit | null },
  ) => {
    openFile(path, opts)
  }

  // Keep open file tabs in sync with explorer mutations, mirroring VS Code's
  // editor handling: a deleted file's tab closes, and a renamed/moved file's
  // tab follows to the new path (descendants of a renamed folder included).
  const handlePathDeleted = (path: string) => {
    for (const t of fileTabs.tabs) {
      if (t.virtual) continue
      if (isDescendantOrSelf(t.path, path)) fileTabs.close(t.path)
    }
  }
  const handlePathRenamed = (from: string, to: string) => {
    for (const t of fileTabs.tabs) {
      if (t.virtual) continue
      if (t.path === from) {
        void openFile(to)
        fileTabs.close(from)
      } else if (isDescendantOrSelf(t.path, from)) {
        void openFile(to + t.path.slice(from.length))
        fileTabs.close(t.path)
      }
    }
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
        auxContainer={auxContainer}
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
        onPathDeleted={handlePathDeleted}
        onPathRenamed={handlePathRenamed}
        sessionId={sessionId}
        onInjectTask={taskInject.inject}
        onOpenContent={openContent}
      />
      {capture.draft && (
        <TaskPicker draft={capture.draft} onClose={capture.close} />
      )}
    </div>
  )
}
