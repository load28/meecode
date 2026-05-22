import { useState } from 'react'
import { invoke } from '@tauri-apps/api/core'
import type { TabDescriptor } from '../components/SessionTabs'
import { truncateWithEllipsis } from '../utils/format'
import { makeTabId, MAIN_TAB_ID } from '../utils/tabId'

export interface TabRecord {
  id: string
  projectPath: string | null
  pendingSessionId: string | null
  needsSwitch: boolean
  /** Bumped on every project/session switch so MainLayout's keyed remount fires. */
  epoch: number
  sessionTitle: string | null
}

function emptyTab(id: string): TabRecord {
  return {
    id,
    projectPath: null,
    pendingSessionId: null,
    needsSwitch: false,
    epoch: 0,
    sessionTitle: null,
  }
}

const SESSION_TITLE_MAX_CHARS = 24

function describeTab(tab: TabRecord, isActive: boolean): TabDescriptor {
  if (!tab.projectPath) {
    return { id: tab.id, label: '새 탭', isActive, isEmpty: true }
  }
  const project = tab.projectPath.split('/').pop() || tab.projectPath
  const title = tab.sessionTitle
    ? truncateWithEllipsis(tab.sessionTitle, SESSION_TITLE_MAX_CHARS)
    : null
  return {
    id: tab.id,
    label: title ? `${project} · ${title}` : project,
    isActive,
    isEmpty: false,
  }
}

export interface UseTabsResult {
  tabs: TabRecord[]
  activeId: string
  descriptors: TabDescriptor[]
  setActiveId: (id: string) => void
  start: (path: string) => void
  switchProject: (path: string) => void
  switchSession: (sessionId: string | null) => void
  newTab: () => void
  closeTab: (id: string) => void
  setSessionTitle: (tabKey: string, title: string | null) => void
}

/**
 * Tab strip state + the mutations the app shell invokes (start, switch,
 * new, close, rename). Encapsulating the `setTabs((list) => list.map(...))`
 * pattern in one place keeps App.tsx focused on routing and removes the
 * risk of two callers using subtly different update shapes.
 */
export function useTabs(): UseTabsResult {
  const [tabs, setTabs] = useState<TabRecord[]>(() => [emptyTab(MAIN_TAB_ID)])
  const [activeId, setActiveId] = useState<string>(MAIN_TAB_ID)

  const updateActive = (patch: (t: TabRecord) => TabRecord) => {
    setTabs((list) => list.map((t) => (t.id === activeId ? patch(t) : t)))
  }

  const start = (path: string) => {
    console.log('[App] handleStart', { tab: activeId, path })
    updateActive((t) => ({
      ...t,
      projectPath: path,
      pendingSessionId: null,
      needsSwitch: true,
    }))
  }

  const switchProject = (path: string) => {
    console.log('[App] handleSwitchProject', { tab: activeId, path })
    const active = tabs.find((t) => t.id === activeId)
    if (path === active?.projectPath) return
    updateActive((t) => ({
      ...t,
      projectPath: path,
      pendingSessionId: null,
      needsSwitch: true,
      epoch: t.epoch + 1,
    }))
  }

  const switchSession = (sessionId: string | null) => {
    console.log('[App] handleSwitchSession', { tab: activeId, sessionId })
    updateActive((t) => ({
      ...t,
      pendingSessionId: sessionId,
      needsSwitch: true,
      epoch: t.epoch + 1,
    }))
  }

  const newTab = () => {
    const id = makeTabId()
    setTabs((list) => [...list, emptyTab(id)])
    setActiveId(id)
  }

  const closeTab = (id: string) => {
    invoke('close_tab', { tabId: id }).catch((e) =>
      console.warn('[meecode] close_tab failed', e),
    )
    setTabs((list) => {
      const next = list.filter((t) => t.id !== id)
      if (next.length === 0) {
        setActiveId(MAIN_TAB_ID)
        return [emptyTab(MAIN_TAB_ID)]
      }
      if (id === activeId) {
        setActiveId(next[next.length - 1].id)
      }
      return next
    })
  }

  const setSessionTitle = (tabKey: string, title: string | null) => {
    setTabs((list) =>
      list.map((t) =>
        t.id === tabKey && t.sessionTitle !== title
          ? { ...t, sessionTitle: title }
          : t,
      ),
    )
  }

  const descriptors = tabs.map((t) => describeTab(t, t.id === activeId))

  return {
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
  }
}
