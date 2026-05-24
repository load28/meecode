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
  } = useTabs()
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
                onSwitchProject={switchProject}
                onSwitchSession={switchSession}
                onSessionTitleChange={(title) => setSessionTitle(t.id, title)}
                claudeReady={claudeStatus.ready}
                onOpenSettings={() => setSettingsOpen(true)}
                showTasks={showTasks}
                onToggleTasks={() => setShowTasks((v) => !v)}
                showExplorer={showExplorer}
                onToggleExplorer={() => setShowExplorer((v) => !v)}
                visible={visible}
              />
            ) : (
              <FolderPicker onStart={start} />
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
