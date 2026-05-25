import { useState } from 'react'
import { SessionTabs } from './components/SessionTabs'
import { FolderPicker } from './components/FolderPicker'
import { MainLayout } from './components/MainLayout'
import { useClaudeStatus } from './hooks/useClaudeStatus'
import { SettingsPanel } from './components/SettingsPanel'
import { PERSISTED_FLAG_KEYS } from './state/persistedFlags'
import { usePersistedBoolean } from './hooks/usePersistedBoolean'
import { useTabs } from './hooks/useTabs'
import './App.css'

function App() {
  const {
    tabs,
    activeId,
    descriptors,
    setActiveId,
    start,
    switchProject,
    switchSession,
    newTab,
    closeTab,
    setSessionTitle,
    markLive,
  } = useTabs()
  const activeTab = tabs.find((t) => t.id === activeId) ?? tabs[0]
  const { status: claudeStatus, refresh: refreshClaudeStatus } = useClaudeStatus()
  const [settingsOpen, setSettingsOpen] = useState(false)
  // Tasks panel open/close is app-wide: toggling it on tab A persists
  // and shows the same state on tab B. Sized by the outer PanelGroup so
  // its width also carries across tabs.
  const [showTasks, setShowTasks] = usePersistedBoolean(
    PERSISTED_FLAG_KEYS.tasksOpen,
    false,
  )
  // File explorer open/close is app-wide too, so the sidebar preference
  // carries across tabs just like Tasks.
  const [showExplorer, setShowExplorer] = usePersistedBoolean(
    PERSISTED_FLAG_KEYS.explorerOpen,
    false,
  )

  return (
    <div className="app-root">
      <SessionTabs
        tabs={descriptors}
        onSelect={setActiveId}
        onClose={closeTab}
        onNew={newTab}
      />
      {/*
        Single reused content pane (VS Code style): only the active tab's
        MainLayout is mounted. Switching tabs swaps `tabId` instead of
        mounting one tree per tab, and per-tab UI state is restored from
        tabViewStore so nothing is lost on switch.
      */}
      <div className="app-tab-host" style={{ display: 'flex' }}>
        {activeTab?.projectPath ? (
          <MainLayout
            tabId={activeTab.id}
            projectPath={activeTab.projectPath}
            pendingSessionId={activeTab.pendingSessionId}
            switchSeq={activeTab.switchSeq}
            onSpawned={markLive}
            onSwitchProject={switchProject}
            onSwitchSession={switchSession}
            onSessionTitleChange={(title) => setSessionTitle(activeTab.id, title)}
            claudeReady={claudeStatus.ready}
            onOpenSettings={() => setSettingsOpen(true)}
            showTasks={showTasks}
            onToggleTasks={() => setShowTasks((v) => !v)}
            showExplorer={showExplorer}
            onToggleExplorer={() => setShowExplorer((v) => !v)}
          />
        ) : (
          <FolderPicker onStart={start} />
        )}
      </div>
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
