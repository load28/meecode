import type { TaskSummary } from '../../types/task'
import { relativeTimeKr } from '../../utils/format'

interface Props {
  loaded: boolean
  tasks: TaskSummary[]
  attachedTaskIds: Set<string> | undefined
  onSelect: (taskId: string) => void
}

/**
 * 사이드 패널의 Task 목록 — 로딩/빈 결과/실제 목록의 세 상태를 다룬다.
 * 각 행에는 이름·attach 배지·source 수·상대 시간·설명 미리보기가 들어간다.
 */
export function TaskBrowserList({
  loaded,
  tasks,
  attachedTaskIds,
  onSelect,
}: Props) {
  if (!loaded) {
    return (
      <div className="task-panel__empty">
        <p>불러오는 중...</p>
      </div>
    )
  }
  if (tasks.length === 0) {
    return (
      <div className="task-panel__empty">
        <p>Task가 없습니다.</p>
        <p className="task-panel__empty-hint">
          위의 + 새 Task 버튼으로 만들어보세요.
        </p>
      </div>
    )
  }
  return (
    <ul className="task-panel__list">
      {tasks.map((t) => {
        const isAttached = attachedTaskIds?.has(t.id) ?? false
        return (
          <li key={t.id} className="task-panel__item">
            <button
              type="button"
              className="task-panel__item-btn"
              onClick={() => onSelect(t.id)}
            >
              <div className="task-panel__item-name">
                {t.name}
                {isAttached && (
                  <span className="task-panel__item-attached">📎 attached</span>
                )}
              </div>
              <div className="task-panel__item-meta">
                <span>{t.source_count} sources</span>
                <span>·</span>
                <span>{relativeTimeKr(t.updated_at_ms)}</span>
              </div>
              {t.description && (
                <div className="task-panel__item-desc">{t.description}</div>
              )}
            </button>
          </li>
        )
      })}
    </ul>
  )
}
