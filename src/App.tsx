import { useEffect, useMemo, useRef, useState } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { open } from '@tauri-apps/plugin-dialog'
import { Panel, PanelGroup, PanelResizeHandle } from 'react-resizable-panels'
import { ChatStream } from './components/ChatStream'
import { ChatComposer } from './components/ChatComposer'
import { ExpandPane } from './components/ExpandPane'
import { SessionInfoBar } from './components/SessionInfoBar'
import { ProjectSwitcher } from './components/ProjectSwitcher'
import { SessionSwitcher } from './components/SessionSwitcher'
import { SessionTabs, type TabDescriptor } from './components/SessionTabs'
import { FilePanel } from './components/FilePanel'
import { TaskBrowser } from './components/TaskBrowser'
import { TaskPicker, type CaptureDraft } from './components/TaskPicker'
import { useFileTabs } from './hooks/useFileTabs'
import { useDetachedFilePanel } from './hooks/useDetachedFilePanel'
import { useTasks } from './hooks/useTasks'
import { useSessionBindings } from './hooks/useSessionBindings'
import { buildTaskContextMessage } from './utils/taskContext'
import type { Source, Task } from './types/task'
import { listen } from '@tauri-apps/api/event'
import { useClaudeSession } from './hooks/useClaudeSession'
import { useClaudeStatus } from './hooks/useClaudeStatus'
import { useExpandPanel } from './hooks/useExpandPanel'
import { SettingsPanel } from './components/SettingsPanel'
import { PERSISTED_FLAG_KEYS } from './state/persistedFlags'
import { usePersistedBoolean } from './hooks/usePersistedBoolean'
import { relativeTimeKr, truncateWithEllipsis } from './utils/format'
import { makeTabId, MAIN_TAB_ID } from './utils/tabId'
import './App.css'

interface RecentProject {
  path: string
  session_count: number
  last_modified_ms: number
}

function FolderPicker({ onStart }: { onStart: (path: string) => void }) {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [recent, setRecent] = useState<RecentProject[]>([])

  useEffect(() => {
    invoke<RecentProject[]>('list_recent_projects')
      .then(setRecent)
      .catch((e) => console.warn('[meecode] list_recent_projects failed', e))
  }, [])

  const startWith = (path: string) => {
    setError('')
    // The owning tab's MainLayout will issue `switch_session` from its
    // mount effect, which avoids the listener-vs-emit race.
    onStart(path)
  }

  const handleSelect = async () => {
    const selected = await open({ directory: true, multiple: false })
    if (!selected || typeof selected !== 'string') return
    setLoading(true)
    try {
      startWith(selected)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="folder-picker">
      <div className="folder-picker__card">
        <div className="folder-picker__logo">M</div>
        <h1 className="folder-picker__title">MeeCode</h1>
        <p className="folder-picker__desc">
          프로젝트 폴더를 선택하면 Claude Code가 해당 디렉토리에서 실행됩니다.
        </p>
        <button
          className="folder-picker__btn"
          onClick={handleSelect}
          disabled={loading}
        >
          {loading ? '시작 중...' : '📂 프로젝트 폴더 선택'}
        </button>
        {error && <p className="folder-picker__error">{error}</p>}
        {recent.length > 0 && (
          <div className="folder-picker__recent">
            <div className="folder-picker__recent-label">최근 프로젝트</div>
            <ul className="folder-picker__recent-list">
              {recent.slice(0, 8).map((p) => (
                <li key={p.path}>
                  <button
                    type="button"
                    className="folder-picker__recent-item"
                    onClick={() => startWith(p.path)}
                    disabled={loading}
                  >
                    <span className="folder-picker__recent-name">
                      {p.path.split('/').pop() || p.path}
                    </span>
                    <span className="folder-picker__recent-meta">
                      {p.session_count}개 · {relativeTimeKr(p.last_modified_ms)}
                    </span>
                    <span className="folder-picker__recent-path">{p.path}</span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  )
}

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

interface MainLayoutProps {
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

function MainLayout({
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
    opts?: { pending?: import('./hooks/useFileTabs').PendingEdit | null },
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
      <div className="app__header">
        <ProjectSwitcher currentPath={projectPath} onSwitch={onSwitchProject} />
        <SessionSwitcher
          projectPath={projectPath}
          currentSessionId={sessionId}
          onSwitch={onSwitchSession}
        />
        {!isOpen && expandedId !== null && (
          <button
            type="button"
            className="app__reopen-btn"
            aria-label="펼쳐보기 패널 열기"
            onClick={toggleOpen}
          >
            ◀ 패널 열기
          </button>
        )}
        <button
          type="button"
          className={`app__knowledge-btn${showTasks ? ' is-active' : ''}`}
          onClick={onToggleTasks}
          title={
            attachedTaskIds.size > 0
              ? `Tasks (${tasks.length}개 · ${attachedTaskIds.size}개 attach됨)`
              : `Tasks (${tasks.length}개)`
          }
        >
          📋 Tasks ({tasks.length})
          {attachedTaskIds.size > 0 && (
            <span className="app__attached-count">
              📎 {attachedTaskIds.size}
            </span>
          )}
        </button>
        <label className="app__auto-toggle">
          <input
            type="checkbox"
            checked={autoExpand}
            onChange={(e) => setAutoExpand(e.target.checked)}
          />
          긴 답변 자동 펼침
        </label>
        {usage.turnCount > 0 && (
          <span
            className="app__usage"
            title={
              `${usage.turnCount} turns · ${usage.inputTokens}↑ ${usage.outputTokens}↓ tokens` +
              (usage.cacheReadTokens || usage.cacheCreationTokens
                ? ` · cache ${usage.cacheReadTokens}↺/${usage.cacheCreationTokens}✦`
                : '')
            }
          >
            ${usage.totalCostUsd.toFixed(4)} · {(usage.totalDurationMs / 1000).toFixed(1)}s
          </span>
        )}
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
            setModel(v === '' ? null : v).catch(() => {})
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

interface TabRecord {
  id: string
  projectPath: string | null
  pendingSessionId: string | null
  needsSwitch: boolean
  epoch: number
  sessionTitle: string | null
}

function App() {
  const [tabs, setTabs] = useState<TabRecord[]>(() => [
    {
      id: MAIN_TAB_ID,
      projectPath: null,
      pendingSessionId: null,
      needsSwitch: false,
      epoch: 0,
      sessionTitle: null,
    },
  ])
  const [activeId, setActiveId] = useState<string>(MAIN_TAB_ID)
  const { status: claudeStatus, refresh: refreshClaudeStatus } = useClaudeStatus()
  const [settingsOpen, setSettingsOpen] = useState(false)
  // Tasks panel open/close is app-wide: toggling it on tab A persists
  // and shows the same state on tab B. Sized by the outer PanelGroup so
  // its width also carries across tabs.
  const [showTasks, setShowTasks] = usePersistedBoolean(
    PERSISTED_FLAG_KEYS.tasksOpen,
    false,
  )

  const activeTab = tabs.find((t) => t.id === activeId) ?? tabs[0]

  const updateTab = (id: string, patch: Partial<TabRecord>) => {
    setTabs((list) => list.map((t) => (t.id === id ? { ...t, ...patch } : t)))
  }

  const handleStart = (path: string) => {
    console.log('[App] handleStart', { tab: activeId, path })
    updateTab(activeId, {
      projectPath: path,
      pendingSessionId: null,
      needsSwitch: true,
    })
  }

  const handleSwitchProject = (path: string) => {
    console.log('[App] handleSwitchProject', { tab: activeId, path })
    if (path === activeTab?.projectPath) return
    setTabs((list) =>
      list.map((t) =>
        t.id === activeId
          ? {
              ...t,
              projectPath: path,
              pendingSessionId: null,
              needsSwitch: true,
              epoch: t.epoch + 1,
            }
          : t,
      ),
    )
  }

  const handleSwitchSession = (sessionId: string | null) => {
    console.log('[App] handleSwitchSession', { tab: activeId, sessionId })
    setTabs((list) =>
      list.map((t) =>
        t.id === activeId
          ? {
              ...t,
              pendingSessionId: sessionId,
              needsSwitch: true,
              epoch: t.epoch + 1,
            }
          : t,
      ),
    )
  }

  const handleNewTab = () => {
    const id = makeTabId()
    setTabs((list) => [
      ...list,
      {
        id,
        projectPath: null,
        pendingSessionId: null,
        needsSwitch: false,
        epoch: 0,
        sessionTitle: null,
      },
    ])
    setActiveId(id)
  }

  const handleCloseTab = (id: string) => {
    invoke('close_tab', { tabId: id }).catch((e) =>
      console.warn('[meecode] close_tab failed', e),
    )
    setTabs((list) => {
      const next = list.filter((t) => t.id !== id)
      if (next.length === 0) {
        const fresh: TabRecord = {
          id: MAIN_TAB_ID,
          projectPath: null,
          pendingSessionId: null,
          needsSwitch: false,
          epoch: 0,
          sessionTitle: null,
        }
        setActiveId(MAIN_TAB_ID)
        return [fresh]
      }
      if (id === activeId) {
        setActiveId(next[next.length - 1].id)
      }
      return next
    })
  }

  const handleSessionTitleChange = (tabKey: string, title: string | null) => {
    setTabs((list) =>
      list.map((t) =>
        t.id === tabKey && t.sessionTitle !== title
          ? { ...t, sessionTitle: title }
          : t,
      ),
    )
  }

  const descriptors: TabDescriptor[] = tabs.map((t) => {
    if (!t.projectPath) {
      return {
        id: t.id,
        label: '새 탭',
        isActive: t.id === activeId,
        isEmpty: true,
      }
    }
    const project = t.projectPath.split('/').pop() || t.projectPath
    const title = t.sessionTitle
      ? truncateWithEllipsis(t.sessionTitle, 24)
      : null
    return {
      id: t.id,
      label: title ? `${project} · ${title}` : project,
      isActive: t.id === activeId,
      isEmpty: false,
    }
  })

  return (
    <div className="app-root">
      <SessionTabs
        tabs={descriptors}
        onSelect={setActiveId}
        onClose={handleCloseTab}
        onNew={handleNewTab}
      />
      {tabs.map((t) => {
        const visible = t.id === activeId
        return (
          <div
            key={t.id}
            className="app-tab-host"
            style={{ display: visible ? 'flex' : 'none' }}
          >
            {t.projectPath ? (
              <MainLayout
                key={`${t.projectPath}::${t.epoch}`}
                tabId={t.id}
                projectPath={t.projectPath}
                pendingSessionId={t.pendingSessionId}
                needsSwitch={t.needsSwitch}
                onSwitchProject={handleSwitchProject}
                onSwitchSession={handleSwitchSession}
                onSessionTitleChange={(title) =>
                  handleSessionTitleChange(t.id, title)
                }
                claudeReady={claudeStatus.ready}
                onOpenSettings={() => setSettingsOpen(true)}
                showTasks={showTasks}
                onToggleTasks={() => setShowTasks((v) => !v)}
                visible={visible}
              />
            ) : (
              <FolderPicker onStart={handleStart} />
            )}
          </div>
        )
      })}
      <SettingsPanel
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        status={claudeStatus}
        onChanged={refreshClaudeStatus}
      />
    </div>
  )
}

export default App
