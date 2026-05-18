import { useMemo, useState } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { open } from '@tauri-apps/plugin-dialog'
import { Panel, PanelGroup, PanelResizeHandle } from 'react-resizable-panels'
import { ChatStream } from './components/ChatStream'
import { ChatComposer } from './components/ChatComposer'
import { ExpandPane } from './components/ExpandPane'
import { SessionInfoBar } from './components/SessionInfoBar'
import { useClaudeSession } from './hooks/useClaudeSession'
import { useExpandPanel } from './hooks/useExpandPanel'
import './App.css'

function FolderPicker({ onStart }: { onStart: (path: string) => void }) {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const handleSelect = async () => {
    const selected = await open({ directory: true, multiple: false })
    if (!selected || typeof selected !== 'string') return
    setLoading(true)
    setError('')
    try {
      console.log('[meecode] start_session →', selected)
      await invoke('start_session', { path: selected })
      console.log('[meecode] start_session resolved')
      onStart(selected)
    } catch (e) {
      console.error('[meecode] start_session failed', e)
      setError(String(e))
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
      </div>
    </div>
  )
}

function MainLayout({ projectPath }: { projectPath: string }) {
  const {
    pairs,
    mode,
    sendUserMessage,
    cycleMode,
    pendingTool,
    respondTool,
    hookActivity,
    rateLimit,
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
  } = useClaudeSession()

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
        <span className="app__path">{projectPath}</span>
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
        <label className="app__auto-toggle">
          <input
            type="checkbox"
            checked={autoExpand}
            onChange={(e) => setAutoExpand(e.target.checked)}
          />
          긴 답변 자동 펼침
        </label>
        {usage.turnCount > 0 && (
          <span className="app__usage" title={`${usage.turnCount} turns · ${usage.inputTokens}↑ ${usage.outputTokens}↓ tokens`}>
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
      </div>
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
      <div className="app__body">
        <PanelGroup direction="horizontal">
          <Panel defaultSize={isOpen ? 60 : 100} minSize={30}>
            <div className="app__chat">
              <ChatStream
                pairs={pairs}
                onExpand={handleExpand}
                pendingTool={pendingTool}
                onRespondTool={(reqId, allow, tuId, updatedInput) => {
                  respondTool(reqId, allow, tuId, updatedInput)
                }}
              />
              <ChatComposer
                mode={mode}
                disabled={pendingTool !== null}
                sendUserMessage={sendUserMessage}
                cycleMode={cycleMode}
                slashCommands={slashCommands}
                model={model}
                busy={hookActivity !== null}
                projectPath={projectPath}
                recentUserTexts={recentUserTexts}
                onClearConversation={clearConversation}
                onInterrupt={() => {
                  interrupt().catch(() => {})
                }}
              />
            </div>
          </Panel>
          {isOpen && (
            <>
              <PanelResizeHandle className="resize-handle" />
              <Panel defaultSize={40} minSize={20}>
                <ExpandPane pair={expandedPair} isOpen={isOpen} onToggle={toggleOpen} />
              </Panel>
            </>
          )}
        </PanelGroup>
      </div>
    </div>
  )
}

function App() {
  const [projectPath, setProjectPath] = useState<string | null>(null)
  if (!projectPath) return <FolderPicker onStart={setProjectPath} />
  return <MainLayout key={projectPath} projectPath={projectPath} />
}

export default App
