import { relativeTimeKr } from '../../utils/format'
import { LOADING } from '../../utils/messages'

export interface SessionInfo {
  session_id: string
  modified_ms: number
  size_bytes: number
  first_message: string | null
  message_count: number
}

interface Props {
  loading: boolean
  sessions: SessionInfo[]
  currentSessionId: string | null
  onPick: (sessionId: string) => void
}

/**
 * SessionSwitcher 패널 내 세션 목록 — 로딩 / 빈 결과 / 행 렌더의 세 상태를
 * 모두 처리. 행에는 첫 메시지 미리보기 + 상대 시간 + 턴 수가 들어간다.
 */
export function SessionList({ loading, sessions, currentSessionId, onPick }: Props) {
  return (
    <ul className="session-switcher__list">
      {loading && <li className="session-switcher__empty">{LOADING}</li>}
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
            onClick={() => onPick(s.session_id)}
            title={s.session_id}
          >
            <span className="session-switcher__item-text">
              {s.first_message || '(빈 세션)'}
            </span>
            <span className="session-switcher__item-meta">
              <span>{relativeTimeKr(s.modified_ms)}</span>
              <span className="session-switcher__item-count">
                {s.message_count}턴
              </span>
            </span>
          </button>
        </li>
      ))}
    </ul>
  )
}
