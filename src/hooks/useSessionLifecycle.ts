import { useEffect, useRef } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { logBackendError } from '../utils/log'

interface Options {
  tabId: string
  projectPath: string
  /** Session to (re)open: null = fresh session, otherwise resume that id. */
  pendingSessionId: string | null
  /**
   * Bumped by `useTabs` every time this tab needs the backend to (re)spawn —
   * an explicit project/session switch, or activating a tab whose process was
   * hibernated. The hook only acts when the value it sees exceeds the last one
   * it handled for this tab, so switching *to* an already-live tab is a no-op.
   */
  switchSeq: number
  /** Called after `switch_session` resolves, so the tab is marked live. */
  onSpawned: (tabId: string) => void
}

/**
 * Drives the backend session for the single, persistent `MainLayout`.
 *
 * Because the layout is no longer remounted on every switch (one reused pane,
 * VS Code style), a mount-only effect can't catch session changes. Instead we
 * watch `switchSeq`: `useTabs` increments it whenever the active tab genuinely
 * needs a (re)spawn, and we fire `switch_session` exactly once per increment.
 * Re-selecting a tab whose process is already running never bumps the seq, so
 * no IPC and no process churn occurs on a plain tab switch.
 */
export function useSessionLifecycle({
  tabId,
  projectPath,
  pendingSessionId,
  switchSeq,
  onSpawned,
}: Options): void {
  const handledRef = useRef<Map<string, number>>(new Map())

  useEffect(() => {
    if (handledRef.current.get(tabId) === switchSeq) return
    handledRef.current.set(tabId, switchSeq)
    invoke('switch_session', {
      path: projectPath,
      sessionId: pendingSessionId,
      tabId,
    })
      .then(() => onSpawned(tabId))
      .catch((e) => logBackendError('meecode', 'switch_session', e))
    // projectPath/pendingSessionId are read at fire time; the (tabId, switchSeq)
    // pair is the trigger, so they intentionally stay out of the deps.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tabId, switchSeq])
}
