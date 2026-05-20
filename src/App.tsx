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
import { KnowledgePanel } from './components/KnowledgePanel'
import { useFileTabs } from './hooks/useFileTabs'
import { useDetachedFilePanel } from './hooks/useDetachedFilePanel'
import { useProjectKnowledge } from './hooks/useProjectKnowledge'
import { listen } from '@tauri-apps/api/event'
import { useClaudeSession } from './hooks/useClaudeSession'
import { useClaudeStatus } from './hooks/useClaudeStatus'
import { useExpandPanel } from './hooks/useExpandPanel'
import { SettingsPanel } from './components/SettingsPanel'
import './App.css'

interface RecentProject {
  path: string
  session_count: number
  last_modified_ms: number
}

function relativeTimeKr(ms: number): string {
  if (!ms) return ''
  const diff = Date.now() - ms
  const m = Math.floor(diff / 60000)
  if (m < 1) return '방금'
  if (m < 60) return `${m}분 전`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}시간 전`
  const d = Math.floor(h / 24)
  if (d < 30) return `${d}일 전`
  const mo = Math.floor(d / 30)
  return `${mo}달 전`
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
  showKnowledge: boolean
  onToggleKnowledge: () => void
  onSetKnowledge: (open: boolean) => void
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
  showKnowledge,
  onToggleKnowledge,
  onSetKnowledge,
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
  } = useClaudeSession(tabId)

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
  const knowledge = useProjectKnowledge(projectPath)
  // Selection captured from a Q&A card, the expand pane, or a file panel,
  // forwarded to the composer where it becomes an inline `[코멘트 #N]`
  // placeholder. `source` is set when the selection came from the file
  // panel (so the expanded block can carry a `// path:lines` header).
  const [pendingSelection, setPendingSelection] = useState<{
    id: number
    text: string
    source?: string
  } | null>(null)

  // Auto-open the knowledge panel when an organize job is running or a diff
  // is waiting for review, so the user actually sees the result.
  useEffect(() => {
    if (
      knowledge.status === 'running' ||
      knowledge.status === 'diff-ready' ||
      knowledge.status === 'error'
    ) {
      onSetKnowledge(true)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [knowledge.status])

  const handlePin = async (input: {
    segmentKind: string
    text: string
    qaId: string
  }) => {
    return knowledge.pin({
      segmentKind: input.segmentKind,
      text: input.text,
      qaId: input.qaId,
      sessionId,
    })
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
          className={`app__knowledge-btn${
            showKnowledge ? ' is-active' : ''
          }`}
          onClick={onToggleKnowledge}
          title={`프로젝트 노트 (${knowledge.pins.length} 핀)`}
        >
          📚 노트 ({knowledge.pins.length})
          {knowledge.status === 'running' && (
            <span className="app__knowledge-pulse" aria-hidden>●</span>
          )}
          {knowledge.status === 'diff-ready' && (
            <span className="app__knowledge-pending" aria-hidden>●</span>
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
          - Outer group ("meecode.layout.knowledge", app-wide): main vs
            knowledge. Resizing the knowledge panel persists across tabs.
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
                defaultSize={
                  isOpen && fileTabs.tabs.length > 0
                    ? 40
                    : isOpen || fileTabs.tabs.length > 0
                    ? 55
                    : 100
                }
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
                    onPin={handlePin}
                    onAddComment={handleAddComment}
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
          {showKnowledge && (
            <>
              <PanelResizeHandle className="resize-handle" />
              <Panel id="knowledge" order={2} defaultSize={28} minSize={20}>
                <KnowledgePanel
                  projectPath={projectPath}
                  onClose={() => onSetKnowledge(false)}
                />
              </Panel>
            </>
          )}
        </PanelGroup>
      </div>
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

function makeTabId(): string {
  return `tab-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
}

const KNOWLEDGE_OPEN_STORAGE_KEY = 'meecode.knowledgeOpen'

function readKnowledgeOpen(): boolean {
  try {
    return localStorage.getItem(KNOWLEDGE_OPEN_STORAGE_KEY) === 'true'
  } catch {
    return false
  }
}

function App() {
  const [tabs, setTabs] = useState<TabRecord[]>(() => [
    {
      id: 'main',
      projectPath: null,
      pendingSessionId: null,
      needsSwitch: false,
      epoch: 0,
      sessionTitle: null,
    },
  ])
  const [activeId, setActiveId] = useState<string>('main')
  const { status: claudeStatus, refresh: refreshClaudeStatus } = useClaudeStatus()
  const [settingsOpen, setSettingsOpen] = useState(false)
  // Knowledge panel open/close is app-wide: toggling it on tab A persists
  // and shows the same state on tab B. Sized by the outer PanelGroup so
  // its width also carries across tabs.
  const [showKnowledge, setShowKnowledgeState] = useState<boolean>(
    readKnowledgeOpen,
  )
  const setShowKnowledge = (next: boolean | ((prev: boolean) => boolean)) => {
    setShowKnowledgeState((prev) => {
      const resolved = typeof next === 'function' ? next(prev) : next
      try {
        localStorage.setItem(KNOWLEDGE_OPEN_STORAGE_KEY, String(resolved))
      } catch {
        /* localStorage unavailable — ignore */
      }
      return resolved
    })
  }

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
          id: 'main',
          projectPath: null,
          pendingSessionId: null,
          needsSwitch: false,
          epoch: 0,
          sessionTitle: null,
        }
        setActiveId('main')
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

  const truncate = (s: string, n: number) =>
    s.length <= n ? s : `${s.slice(0, n)}…`

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
    const title = t.sessionTitle ? truncate(t.sessionTitle, 24) : null
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
                showKnowledge={showKnowledge}
                onToggleKnowledge={() => setShowKnowledge((v) => !v)}
                onSetKnowledge={(open) => setShowKnowledge(open)}
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
