import { useEffect, useMemo, useRef, useState } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { Panel, PanelGroup, PanelResizeHandle } from 'react-resizable-panels'
import { ChatStream } from '../ChatStream'
import { ChatComposer } from '../ChatComposer'
import { ExpandPane } from '../ExpandPane'
import { FilePanel } from '../FilePanel'
import { MainHeader } from './MainHeader'
import { TaskBrowser } from '../TaskBrowser'
import { TaskPicker, type CaptureDraft } from '../TaskPicker'
import { useFileTabs, type PendingEdit } from '../../hooks/useFileTabs'
import { useDetachedFilePanel } from '../../hooks/useDetachedFilePanel'
import { useTasks } from '../../hooks/useTasks'
import { useSessionBindings } from '../../hooks/useSessionBindings'
import { buildTaskContextMessage } from '../../utils/taskContext'
import type { Source, Task } from '../../types/task'
import { useClaudeSession } from '../../hooks/useClaudeSession'
import { useExpandPanel } from '../../hooks/useExpandPanel'

/**
 * How wide the chat column should sit at, in % of its row. The chat row
 * is shared with two optional siblings — the expand pane and the file
 * pane. With one sibling visible we leave a ~45% margin for it; with
 * both, ~60%; on its own, the chat takes the whole row.
 */
function chatPanelDefaultSize(
  expandOpen: boolean,
  fileTabsOpen: boolean,
): number {
  if (expandOpen && fileTabsOpen) return 40
  if (expandOpen || fileTabsOpen) return 55
  return 100
}

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
  const {
    pairs,
    mode,
    sendUserMessage,
    cycleMode,
    pendingTool,
    respondTool,
    hookActivity,
    taskActivity,
    rateLimit,
    turnError,
    turnInProgress,
    dismissRateLimit,
    slashCommands,
    model,
    interrupt,
    usage,
    setModel,
    clearConversation,
    sessionId,
    cwd,
    mcpServers,
    agents,
    tools,
    queue,
    removeQueued,
    sessionTitle,
  } = useClaudeSession(tabId, visible)
  const { tasks } = useTasks()
  const sessionBindings = useSessionBindings(sessionId)
  const attachedTaskIds = useMemo(
    () => new Set(sessionBindings.bindings.map((b) => b.task_id)),
    [sessionBindings.bindings],
  )

  const titleCbRef = useRef(onSessionTitleChange)
  titleCbRef.current = onSessionTitleChange
  useEffect(() => {
    titleCbRef.current(sessionTitle)
  }, [sessionTitle])

  // The parent forces a remount on every switch by bumping the component
  // key, so this effect re-fires only for genuine switches. Listener race
  // is no longer an issue: the store registers listeners once at page
  // load, so backend emits can never be lost between mount/cleanup cycles.
  const switchedRef = useRef(false)
  useEffect(() => {
    if (!needsSwitch) return
    if (switchedRef.current) return
    switchedRef.current = true
    invoke('switch_session', {
      path: projectPath,
      sessionId: pendingSessionId,
      tabId,
    }).catch((e) => console.warn('[meecode] switch_session failed', e))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

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
  const [pendingSelection, setPendingSelection] = useState<{
    id: number
    text: string
    source?: string
  } | null>(null)
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

  const handleAttachTask = async (taskId: string) => {
    if (!sessionId) return
    // 1. Persist the binding first so the UI flips immediately and the
    //    binding survives even if the inject step below errors out.
    const binding = await sessionBindings.attach(taskId)
    if (!binding) return
    // 2. Pull the task + sources from the backend on demand. The browser
    //    list already has a TaskSummary but lacks `description` (it does
    //    in fact, but we still need sources separately), and the source
    //    list isn't cached anywhere — go to the source of truth.
    try {
      const [task, sources] = await Promise.all([
        invoke<Task>('get_task', { taskId }),
        invoke<Source[]>('list_task_sources', { taskId }),
      ])
      const message = buildTaskContextMessage(task, sources)
      if (!message) {
        // Empty task — attach succeeded but nothing to inject. Show a
        // light note so the user understands why the chat didn't get a
        // new turn. `window.alert` is intentionally plain for now; a
        // proper toast lands with the next polish pass.
        console.info(
          `[tasks] attached "${task.name}" but it has no content to inject.`,
        )
        return
      }
      await sendUserMessage(message)
    } catch (e) {
      console.warn('[tasks] context injection failed', e)
    }
  }

  const handleDetachTask = async (taskId: string) => {
    await sessionBindings.detach(taskId)
  }

  const handleOpenFile = (
    path: string,
    opts?: { pending?: PendingEdit | null },
  ) => {
    openFile(path, opts)
  }
  const handleAddSnippet = (snippet: {
    text: string
    path: string
    startLine: number
    endLine: number
  }) => {
    const range =
      snippet.startLine === snippet.endLine
        ? `:${snippet.startLine}`
        : `:${snippet.startLine}-${snippet.endLine}`
    setPendingSelection({
      id: Date.now(),
      text: snippet.text,
      source: `${snippet.path}${range}`,
    })
  }

  const handleAddComment = (text: string) => {
    setPendingSelection({ id: Date.now(), text })
  }

  // The detached window can't reach our composer state directly, so it
  // forwards selection snippets through this event. Treat them exactly like
  // an inline add-context click.
  useEffect(() => {
    let unlisten: (() => void) | null = null
    let mounted = true
    void listen<{
      text: string
      path: string
      startLine: number
      endLine: number
    }>('composer:add-context', (e) => {
      handleAddSnippet(e.payload)
    }).then((u) => {
      if (!mounted) {
        u()
        return
      }
      unlisten = u
    })
    return () => {
      mounted = false
      unlisten?.()
    }
  }, [])

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
      <div className="app__banners">
        {hookActivity && (
          <div className="app__hook-banner">⚙ {hookActivity}</div>
        )}
        {rateLimit && (
          <div className="app__rate-limit-banner" role="alert">
            <span>⚠ {rateLimit}</span>
            <button
              type="button"
              className="app__rate-limit-dismiss"
              onClick={dismissRateLimit}
            >
              닫기
            </button>
          </div>
        )}
        {turnError && (
          <div className="app__turn-error-banner" role="status">
            <span>⚠ {turnError}</span>
          </div>
        )}
      </div>
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
            <PanelGroup
              direction="horizontal"
              autoSaveId={`meecode.layout.tab.${tabId}`}
            >
              <Panel
                id="chat"
                order={1}
                defaultSize={chatPanelDefaultSize(
                  isOpen,
                  fileTabs.tabs.length > 0,
                )}
                minSize={25}
              >
                <div className="app__chat">
                  <ChatStream
                    pairs={pairs}
                    onExpand={handleExpand}
                    pendingTool={pendingTool}
                    onOpenFile={handleOpenFile}
                    taskActivity={taskActivity}
                    hookActivity={hookActivity}
                    turnInProgress={turnInProgress}
                    onAddComment={handleAddComment}
                    onCapture={handleCapture}
                    onRespondTool={(reqId, allow, tuId, updatedInput, denialMessage) => {
                      const effective =
                        allow && (updatedInput === undefined || updatedInput === null)
                          ? pendingTool?.input ?? {}
                          : updatedInput
                      respondTool(reqId, allow, tuId, effective, denialMessage)
                    }}
                  />
                  {queue.length > 0 && (
                    <div className="app__queue">
                      <div className="app__queue-label">
                        ⏳ 큐에 대기 중 ({queue.length})
                      </div>
                      {queue.map((q) => (
                        <div key={q.id} className="app__queue-item">
                          <span className="app__queue-text">{q.text || '🖼'}</span>
                          <button
                            type="button"
                            className="app__queue-remove"
                            onClick={() => removeQueued(q.id)}
                            title="큐에서 제거"
                          >
                            ×
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                  <ChatComposer
                    mode={mode}
                    disabled={pendingTool !== null}
                    sendUserMessage={sendUserMessage}
                    cycleMode={cycleMode}
                    slashCommands={slashCommands}
                    model={model}
                    // CLI parity (CancelRequestHandler.canCancelRunningTask):
                    // the stop affordance is active iff a turn is currently
                    // running. Queued messages have their own X-buttons in the
                    // queue list and auto-drain once the turn settles.
                    busy={turnInProgress}
                    projectPath={projectPath}
                    recentUserTexts={recentUserTexts}
                    onClearConversation={clearConversation}
                    pendingSelection={pendingSelection}
                    onSelectionConsumed={() => setPendingSelection(null)}
                    onInterrupt={() => {
                      interrupt().catch(() => {})
                    }}
                    claudeReady={claudeReady}
                    onOpenSettings={onOpenSettings}
                  />
                </div>
              </Panel>
              {isOpen && (
                <>
                  <PanelResizeHandle className="resize-handle" />
                  <Panel id="expand" order={2} defaultSize={30} minSize={20}>
                    <ExpandPane
                      pair={expandedPair}
                      isOpen={isOpen}
                      onToggle={toggleOpen}
                      onOpenFile={handleOpenFile}
                      pairs={pairs}
                      pendingTool={pendingTool}
                      turnInProgress={turnInProgress}
                      taskActivity={taskActivity}
                      hookActivity={hookActivity}
                      onAddComment={handleAddComment}
                      onCapture={handleCapture}
                    />
                  </Panel>
                </>
              )}
              {!isDetached && fileTabs.tabs.length > 0 && (
                <>
                  <PanelResizeHandle className="resize-handle" />
                  <Panel id="file" order={3} defaultSize={35} minSize={20}>
                    <FilePanel
                      tabs={fileTabs.tabs}
                      activePath={fileTabs.activePath}
                      onSelect={fileTabs.setActive}
                      onClose={fileTabs.close}
                      onCloseAll={fileTabs.closeAll}
                      onSetViewMode={fileTabs.setViewMode}
                      onSetMarkdownView={fileTabs.setMarkdownView}
                      onAddSelectionToComposer={handleAddSnippet}
                      onDetach={() => {
                        void detach()
                      }}
                    />
                  </Panel>
                </>
              )}
            </PanelGroup>
          </Panel>
          {showTasks && (
            <>
              <PanelResizeHandle className="resize-handle" />
              <Panel id="knowledge" order={2} defaultSize={28} minSize={20}>
                <TaskBrowser
                  onClose={onToggleTasks}
                  sessionId={sessionId}
                  attachedTaskIds={attachedTaskIds}
                  onAttachTask={handleAttachTask}
                  onDetachTask={handleDetachTask}
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
