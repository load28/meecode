import { useEffect, useRef } from 'react'
import { invoke } from '@tauri-apps/api/core'

interface Options {
  tabId: string
  projectPath: string
  pendingSessionId: string | null
  /** false면 아무 일도 하지 않는다 (이미 같은 세션). */
  needsSwitch: boolean
}

/**
 * 탭이 마운트된 직후 한 번만 `switch_session` IPC를 호출한다.
 *
 * 부모는 진짜 switch가 필요할 때만 컴포넌트의 key를 갱신해서 새로 마운트
 * 시키므로 effect는 mount 사이클당 한 번만 fire한다. switchedRef가 한
 * 번 더 안전망 역할 — StrictMode의 두 번 호출에도 IPC가 두 번 가지 않게.
 */
export function useSessionSwitchOnMount({
  tabId,
  projectPath,
  pendingSessionId,
  needsSwitch,
}: Options): void {
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
    // mount 시점의 needsSwitch만 본다 — deps는 비워둔다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
}
