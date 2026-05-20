import { useCallback, useEffect, useRef, useState } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { Icon } from '../Icon'
import './SessionSwitcher.css'

interface SessionInfo {
  session_id: string
  modified_ms: number
  size_bytes: number
  first_message: string | null
  message_count: number
}

interface Props {
  projectPath: string
  currentSessionId: string | null
  onSwitch: (sessionId: string | null) => void
}

function formatRelativeTime(ms: number): string {
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
      console.warn('[meecode] list_project_sessions failed', e)
    } finally {
      setLoading(false)
    }
  }, [projectPath])

  useEffect(() => {
    if (open) load()
  }, [open, load])

  useEffect(() => {
    if (!open) return
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  return (
    <div className="session-switcher" ref={ref}>
      <button
        type="button"
        className="session-switcher__toggle"
        onClick={() => setOpen((v) => !v)}
        title="세션 목록"
      >
        <span className="session-switcher__icon"><Icon name="comment" /></span>
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
          <ul className="session-switcher__list">
            {loading && (
              <li className="session-switcher__empty">불러오는 중…</li>
            )}
            {!loading && sessions.length === 0 && (
              <li className="session-switcher__empty">아직 세션이 없습니다.</li>
            )}
            {sessions.map((s) => (
              <li key={s.session_id}>
                <button
                  type="button"
                  className={
                    'session-switcher__item' +
                    (s.session_id === currentSessionId ? ' is-current' : '')
                  }
                  onClick={() => {
                    setOpen(false)
                    if (s.session_id !== currentSessionId) {
                      onSwitch(s.session_id)
                    }
                  }}
                  title={s.session_id}
                >
                  <span className="session-switcher__item-text">
                    {s.first_message || '(빈 세션)'}
                  </span>
                  <span className="session-switcher__item-meta">
                    <span>{formatRelativeTime(s.modified_ms)}</span>
                    <span className="session-switcher__item-count">
                      {s.message_count}턴
                    </span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}
