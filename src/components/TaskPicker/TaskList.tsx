import type { TaskSummary } from '../../types/task'
import { LOADING } from '../../utils/messages'

const PREVIEW_MAX_CHARS = 80

function previewLine(text: string): string {
  const first = text.split('\n').find((l) => l.trim()) ?? text
  return first.length > PREVIEW_MAX_CHARS
    ? `${first.slice(0, PREVIEW_MAX_CHARS)}…`
    : first
}

interface Props {
  loaded: boolean
  total: number
  filtered: TaskSummary[]
  focusIdx: number
  submitting: boolean
  onFocus: (idx: number) => void
  onPick: (taskId: string) => void
}

/**
 * TaskPicker 본문 — 로드/빈 결과/필터링된 목록의 세 가지 상태를 한 군데서
 * 처리. 빈 상태일 때는 검색 결과 없음 / Task가 하나도 없음 두 메시지를
 * 분기한다.
 */
export function TaskList({
  loaded,
  total,
  filtered,
  focusIdx,
  submitting,
  onFocus,
  onPick,
}: Props) {
  if (!loaded) {
    return <div className="task-picker__empty">{LOADING}</div>
  }
  if (filtered.length === 0) {
    return (
      <div className="task-picker__empty">
        {total === 0
          ? '아직 Task가 없습니다. 아래에서 만들어보세요.'
          : '검색 결과 없음'}
      </div>
    )
  }
  return (
    <ul className="task-picker__list">
      {filtered.map((t, i) => (
        <li key={t.id}>
          <button
            type="button"
            className={`task-picker__item${i === focusIdx ? ' is-focused' : ''}`}
            onClick={() => onPick(t.id)}
            onMouseEnter={() => onFocus(i)}
            disabled={submitting}
          >
            <div className="task-picker__item-name">{t.name}</div>
            <div className="task-picker__item-meta">
              {t.source_count} sources
              {t.description ? ` · ${previewLine(t.description)}` : ''}
            </div>
          </button>
        </li>
      ))}
    </ul>
  )
}
