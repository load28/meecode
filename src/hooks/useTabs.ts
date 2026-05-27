import { useCallback, useEffect, useRef, useState } from 'react'
import { invoke } from '../platform/ipc'
import type { TabDescriptor } from '../components/SessionTabs'
import { truncateWithEllipsis } from '../utils/format'
import { makeTabId, MAIN_TAB_ID } from '../utils/tabId'
import { logBackendError } from '../utils/log'
import { getTabSnapshot, resetTab } from '../state/sessionStore'
import { clearTabState } from '../state/tabViewStore'

export interface TabRecord {
  id: string
  projectPath: string | null
  pendingSessionId: string | null
  sessionTitle: string | null
  /** Whether this tab's backend Claude process is currently running. */
  live: boolean
  /**
   * Monotonic counter bumped whenever the tab needs a (re)spawn — an explicit
   * project/session switch, or activating a hibernated tab. `useSessionLifecycle`
   * fires `switch_session` once per increment. Not used as a React key, so it
   * never forces a remount.
   */
  switchSeq: number
}

function emptyTab(id: string): TabRecord {
  return {
    id,
    projectPath: null,
    pendingSessionId: null,
    sessionTitle: null,
    live: false,
    switchSeq: 0,
  }
}

const SESSION_TITLE_MAX_CHARS = 24

/**
 * Background tabs that have been idle this long get their Claude process
 * killed (hibernated) to cap resource use; the session resumes via `--resume`
 * on reactivation. Tabs mid-turn are never hibernated.
 */
const IDLE_HIBERNATE_MS = 5 * 60 * 1000

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
  /** Called by the active MainLayout once its backend process has spawned. */
  markLive: (tabId: string) => void
}

/**
 * Tab strip state + the mutations the app shell invokes. With the single-pane
 * (VS Code style) view, this hook also owns the session lifecycle bookkeeping:
 * which tab's process is live, when to (re)spawn, and a background idle timer
 * that hibernates inactive tabs.
 */
export function useTabs(): UseTabsResult {
  const [tabs, setTabs] = useState<TabRecord[]>(() => [emptyTab(MAIN_TAB_ID)])
  const [activeId, setActiveIdState] = useState<string>(MAIN_TAB_ID)

  const updateActive = useCallback(
    (patch: (t: TabRecord) => TabRecord) => {
      setTabs((list) => list.map((t) => (t.id === activeId ? patch(t) : t)))
    },
    [activeId],
  )

  // Explicit (re)open of a project/session: clear the tab's session + view
  // state for a clean slate, then bump switchSeq so the lifecycle hook spawns.
  const start = useCallback(
    (path: string) => {
      resetTab(activeId)
      clearTabState(activeId)
      updateActive((t) => ({
        ...t,
        projectPath: path,
        pendingSessionId: null,
        live: false,
        switchSeq: t.switchSeq + 1,
      }))
    },
    [activeId, updateActive],
  )

  const switchProject = useCallback(
    (path: string) => {
      const active = tabs.find((t) => t.id === activeId)
      if (path === active?.projectPath) return
      resetTab(activeId)
      clearTabState(activeId)
      updateActive((t) => ({
        ...t,
        projectPath: path,
        pendingSessionId: null,
        live: false,
        switchSeq: t.switchSeq + 1,
      }))
    },
    [activeId, tabs, updateActive],
  )

  const switchSession = useCallback(
    (sessionId: string | null) => {
      resetTab(activeId)
      clearTabState(activeId)
      updateActive((t) => ({
        ...t,
        pendingSessionId: sessionId,
        live: false,
        switchSeq: t.switchSeq + 1,
      }))
    },
    [activeId, updateActive],
  )

  const newTab = useCallback(() => {
    const id = makeTabId()
    setTabs((list) => [...list, emptyTab(id)])
    setActiveIdState(id)
  }, [])

  const markLive = useCallback((tabId: string) => {
    setTabs((list) =>
      list.map((t) => (t.id === tabId ? { ...t, live: true } : t)),
    )
  }, [])

  // --- Background idle hibernation ---
  const timersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(
    new Map(),
  )

  const markHibernated = useCallback((tabId: string) => {
    setTabs((list) =>
      list.map((t) => (t.id === tabId ? { ...t, live: false } : t)),
    )
  }, [])

  useEffect(() => {
    const timers = timersRef.current
    const clear = (id: string) => {
      const h = timers.get(id)
      if (h) {
        clearTimeout(h)
        timers.delete(id)
      }
    }
    for (const t of tabs) {
      // Active tab and tabs with no live process never need a timer.
      if (t.id === activeId || !t.live || !t.projectPath) {
        clear(t.id)
        continue
      }
      if (timers.has(t.id)) continue
      const arm = () => {
        const snap = getTabSnapshot(t.id)
        if (snap.turnInProgress || snap.pendingTool) {
          // Working in the background — re-check later, never kill mid-turn.
          timers.set(t.id, setTimeout(arm, IDLE_HIBERNATE_MS))
          return
        }
        timers.delete(t.id)
        invoke('hibernate_tab', { tabId: t.id })
          .then(() => markHibernated(t.id))
          .catch((e) => logBackendError('meecode', 'hibernate_tab', e))
      }
      timers.set(t.id, setTimeout(arm, IDLE_HIBERNATE_MS))
    }
  }, [tabs, activeId, markHibernated])

  // Clear every pending timer when the app tears down.
  useEffect(() => {
    const timers = timersRef.current
    return () => {
      for (const h of timers.values()) clearTimeout(h)
      timers.clear()
    }
  }, [])

  // Selecting a tab whose process was hibernated (or never started) bumps its
  // switchSeq so the lifecycle hook resumes it via `--resume`; selecting a live
  // tab is a pure view swap with no backend call.
  const setActiveId = useCallback((id: string) => {
    setTabs((list) =>
      list.map((t) => {
        if (t.id !== id) return t
        if (t.projectPath && !t.live) {
          const resumeId = t.pendingSessionId ?? getTabSnapshot(id).sessionId
          return { ...t, pendingSessionId: resumeId, switchSeq: t.switchSeq + 1 }
        }
        return t
      }),
    )
    setActiveIdState(id)
  }, [])

  const closeTab = useCallback(
    (id: string) => {
      invoke('close_tab', { tabId: id }).catch((e) =>
        logBackendError('meecode', 'close_tab', e),
      )
      const timer = timersRef.current.get(id)
      if (timer) {
        clearTimeout(timer)
        timersRef.current.delete(id)
      }
      clearTabState(id)
      setTabs((list) => {
        const next = list.filter((t) => t.id !== id)
        if (next.length === 0) {
          setActiveIdState(MAIN_TAB_ID)
          return [emptyTab(MAIN_TAB_ID)]
        }
        if (id !== activeId) return next
        // Closing the active tab: focus the last remaining tab and resume it
        // if its process was hibernated, mirroring setActiveId's logic.
        const target = next[next.length - 1]
        setActiveIdState(target.id)
        return next.map((t) =>
          t.id === target.id && t.projectPath && !t.live
            ? {
                ...t,
                pendingSessionId:
                  t.pendingSessionId ?? getTabSnapshot(target.id).sessionId,
                switchSeq: t.switchSeq + 1,
              }
            : t,
        )
      })
    },
    [activeId],
  )

  const setSessionTitle = useCallback(
    (tabKey: string, title: string | null) => {
      setTabs((list) =>
        list.map((t) =>
          t.id === tabKey && t.sessionTitle !== title
            ? { ...t, sessionTitle: title }
            : t,
        ),
      )
    },
    [],
  )

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
    markLive,
  }
}
