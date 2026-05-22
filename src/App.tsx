import { useState } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { SessionTabs, type TabDescriptor } from './components/SessionTabs'
import { FolderPicker } from './components/FolderPicker'
import { MainLayout } from './components/MainLayout'
import { useClaudeStatus } from './hooks/useClaudeStatus'
import { SettingsPanel } from './components/SettingsPanel'
import { PERSISTED_FLAG_KEYS } from './state/persistedFlags'
import { usePersistedBoolean } from './hooks/usePersistedBoolean'
import { truncateWithEllipsis } from './utils/format'
import { makeTabId, MAIN_TAB_ID } from './utils/tabId'
import './App.css'

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
