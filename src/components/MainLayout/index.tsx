import { useMemo, useState } from 'react'
import { Panel, PanelGroup, PanelResizeHandle } from 'react-resizable-panels'
import { MainHeader } from './MainHeader'
import { MainBanners } from './MainBanners'
import { InnerPanelGroup } from './InnerPanelGroup'
import { TaskBrowser } from '../TaskBrowser'
import { TaskPicker, type CaptureDraft } from '../TaskPicker'
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

  const recentUserTexts = useMemo(() => {
    return pairs
      .map((p) => p.user_text)
      .filter((t) => !!t && !t.startsWith('──'))
      .slice(-20)
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
  const { isDetached, detach, openFile } = useDetachedFilePanel(fileTabs)
  // Selection captured from a Q&A card, the expand pane, or a file panel,
  // forwarded to the composer where it becomes an inline `[코멘트 #N]`
  // placeholder. `source` is set when the selection came from the file
  // panel (so the expanded block can carry a `// path:lines` header).
  const selection = usePendingSelection()
  // QaCard's capture button / CommentFloat's 📥 button push a draft here;
  // TaskPicker (mounted below) reads it and writes the resulting Source.
  // null = picker hidden.
  const [pendingCapture, setPendingCapture] = useState<CaptureDraft | null>(null)

  const handleCapture = (input: {
    kind: 'qa_block' | 'selection'
    content: string
    qaId: string
  }) => {
    setPendingCapture({
      kind: input.kind,
      content: input.content,
      sessionId: sessionId ?? null,
      qaId: input.qaId,
      projectPath,
    })
  }

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
  const expandedPair = useMemo(
    () => pairs.find((p) => p.id === expandedId) ?? null,
    [pairs, expandedId]
  )

  const handleExpand = (id: string) => {
    setExpandedId(id)
    if (!isOpen) toggleOpen()
  }

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
      <div className="app__body">
        {/*
          Two nested PanelGroups so panel sizes can have different scopes:
          - Outer group (app-wide): main content vs side panel (Tasks).
            Resizing the side panel persists across tabs. The autoSaveId
            keeps its historical "knowledge" name so existing users don't
            lose their saved layout.
          - Inner group (per-tab id): chat / expand / file. Each tab keeps
            its own ratios as panels open and close. The library remembers
            each panel-combination's layout separately keyed by the stable
            `id` we hand each Panel.
        */}
        <PanelGroup
          direction="horizontal"
          autoSaveId="meecode.layout.knowledge"
        >
          <Panel id="main-content" order={1} minSize={30}>
            <InnerPanelGroup
              tabId={tabId}
              projectPath={projectPath}
              claudeReady={claudeReady}
              claude={claude}
              fileTabs={fileTabs}
              recentUserTexts={recentUserTexts}
              expandedPair={expandedPair}
              isExpandOpen={isOpen}
              onToggleExpand={toggleOpen}
              isDetached={isDetached}
              onDetachFilePanel={() => {
                void detach()
              }}
              selection={selection}
              onCapture={handleCapture}
              onExpand={handleExpand}
              onOpenFile={handleOpenFile}
              onOpenSettings={onOpenSettings}
            />
          </Panel>
          {showTasks && (
            <>
              <PanelResizeHandle className="resize-handle" />
              <Panel id="knowledge" order={2} defaultSize={28} minSize={20}>
                <TaskBrowser
                  onClose={onToggleTasks}
                  sessionId={sessionId}
                  attachedTaskIds={attachedTaskIds}
                  onAttachTask={taskAttach.attach}
                  onDetachTask={taskAttach.detach}
                />
              </Panel>
            </>
          )}
        </PanelGroup>
      </div>
      {pendingCapture && (
        <TaskPicker
          draft={pendingCapture}
          onClose={() => setPendingCapture(null)}
        />
      )}
    </div>
  )
}
