import { useCallback, useEffect, useRef, useState } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { useClickOutside } from '../../hooks/useClickOutside'
import { logBackendError } from '../../utils/log'
import { SessionList, type SessionInfo } from './SessionList'
import './SessionSwitcher.css'

interface Props {
  projectPath: string
  currentSessionId: string | null
  onSwitch: (sessionId: string | null) => void
}

export function SessionSwitcher({
  projectPath,
  currentSessionId,
  onSwitch,
}: Props) {
  const [open, setOpen] = useState(false)
  const [sessions, setSessions] = useState<SessionInfo[]>([])
  const [loading, setLoading] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const result = await invoke<SessionInfo[]>('list_project_sessions', {
        path: projectPath,
      })
      setSessions(result)
    } catch (e) {
      logBackendError('meecode', 'list_project_sessions', e)
    } finally {
      setLoading(false)
    }
  }, [projectPath])

  useEffect(() => {
    if (open) load()
  }, [open, load])

  useClickOutside(ref, open, () => setOpen(false))

  const handlePick = (sessionId: string) => {
    setOpen(false)
    if (sessionId !== currentSessionId) onSwitch(sessionId)
  }

  return (
    <div className="session-switcher" ref={ref}>
      <button
        type="button"
        className="session-switcher__toggle"
        onClick={() => setOpen((v) => !v)}
        title="세션 목록"
      >
        <span className="session-switcher__icon">🗂</span>
        <span className="session-switcher__label">세션</span>
        <span className="session-switcher__caret">▾</span>
      </button>
      {open && (
        <div className="session-switcher__panel">
          <button
            type="button"
            className="session-switcher__new"
            onClick={() => {
              setOpen(false)
              onSwitch(null)
            }}
          >
            ＋ 새 세션 시작
          </button>
          <div className="session-switcher__header">최근 세션</div>
          <SessionList
            loading={loading}
            sessions={sessions}
            currentSessionId={currentSessionId}
            onPick={handlePick}
          />
        </div>
      )}
    </div>
  )
}
