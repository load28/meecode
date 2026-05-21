import { useEffect, useState } from 'react'
import { useTasks, useTaskDetail } from '../../hooks/useTasks'
import '../TaskBrowser/TaskBrowser.css'

interface Props {
  taskId: string
  onBack: () => void
  onClose?: () => void
  onDeleted?: () => void
}

function formatTs(ms: number): string {
  if (!ms) return ''
  const d = new Date(ms)
  const yy = d.getFullYear()
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  const hh = String(d.getHours()).padStart(2, '0')
  const mi = String(d.getMinutes()).padStart(2, '0')
  return `${yy}-${mm}-${dd} ${hh}:${mi}`
}

export function TaskDetail({ taskId, onBack, onClose, onDeleted }: Props) {
  const { updateTask, deleteTask } = useTasks()
  const { task, sources, loading, error, setTask } = useTaskDetail(taskId)

  // Edits stay local until the input is blurred, so every keystroke isn't
  // an IPC roundtrip + disk write.
  const [name, setName] = useState('')
  const [desc, setDesc] = useState('')
  useEffect(() => {
    if (task) {
      setName(task.name)
      setDesc(task.description)
    }
  }, [task?.id])

  const commitName = async () => {
    if (!task) return
    const trimmed = name.trim()
    if (!trimmed || trimmed === task.name) {
      setName(task.name)
      return
    }
    const next = await updateTask(task.id, { name: trimmed })
    if (next) setTask(next)
  }

  const commitDesc = async () => {
    if (!task) return
    if (desc === task.description) return
    const next = await updateTask(task.id, { description: desc })
    if (next) setTask(next)
  }

  const handleDelete = async () => {
    if (!task) return
    if (!confirm(`Task "${task.name}"을(를) 삭제하시겠습니까?\n관련된 모든 Source와 Wiki도 함께 삭제됩니다.`)) {
      return
    }
    await deleteTask(task.id)
    onDeleted?.()
  }

  return (
    <div className="task-panel">
      <div className="task-panel__header">
        <button
          type="button"
          className="task-panel__back"
          onClick={onBack}
          aria-label="목록으로"
        >
          ←
        </button>
        <h2 className="task-panel__title">
          {task?.name ?? (loading ? '불러오는 중...' : 'Task')}
        </h2>
        {onClose && (
          <button
            type="button"
            className="task-panel__close"
            onClick={onClose}
            aria-label="패널 닫기"
          >
            ×
          </button>
        )}
      </div>
      {error && <div className="task-detail__error">{error}</div>}
      {task && (
        <>
          <div className="task-detail__field">
            <label className="task-detail__label" htmlFor="task-detail-name">
              이름
            </label>
            <input
              id="task-detail-name"
              className="task-detail__name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              onBlur={commitName}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  ;(e.target as HTMLInputElement).blur()
                }
              }}
            />
          </div>
          <div className="task-detail__field">
            <label className="task-detail__label" htmlFor="task-detail-desc">
              설명
            </label>
            <textarea
              id="task-detail-desc"
              className="task-detail__desc"
              value={desc}
              onChange={(e) => setDesc(e.target.value)}
              onBlur={commitDesc}
              placeholder="이 Task가 무엇에 대한 작업인지 적어두세요"
            />
          </div>
          <div className="task-detail__meta">
            <span>생성 {formatTs(task.created_at_ms)}</span>
            <span>수정 {formatTs(task.updated_at_ms)}</span>
          </div>
          <div className="task-detail__section">
            <h3 className="task-detail__section-title">
              Sources ({sources.length})
            </h3>
            {sources.length === 0 ? (
              <div className="task-detail__section-empty">
                아직 Source가 없습니다.
                <br />
                <span style={{ fontSize: 11 }}>
                  채팅에서 답변을 캡처하는 기능은 다음 단계에서 추가됩니다.
                </span>
              </div>
            ) : (
              <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
                {sources.map((s) => (
                  <li
                    key={s.id}
                    style={{
                      background: '#0d1117',
                      border: '1px solid #21262d',
                      borderRadius: 6,
                      padding: 8,
                      marginBottom: 6,
                      fontSize: 12,
                      color: '#c9d1d9',
                    }}
                  >
                    <div
                      style={{
                        fontSize: 10,
                        color: '#6e7681',
                        marginBottom: 4,
                      }}
                    >
                      {s.kind} · {formatTs(s.captured_at_ms)}
                    </div>
                    <div
                      style={{
                        whiteSpace: 'pre-wrap',
                        wordBreak: 'break-word',
                        maxHeight: 120,
                        overflow: 'hidden',
                      }}
                    >
                      {s.content.slice(0, 400)}
                      {s.content.length > 400 ? '…' : ''}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div className="task-detail__footer">
            <button
              type="button"
              className="task-panel__btn task-panel__btn--danger"
              onClick={handleDelete}
            >
              Task 삭제
            </button>
          </div>
        </>
      )}
    </div>
  )
}
