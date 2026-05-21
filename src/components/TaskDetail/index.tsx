import { useEffect, useState } from 'react'
import { useTasks, useTaskDetail } from '../../hooks/useTasks'
import '../TaskBrowser/TaskBrowser.css'

interface Props {
  taskId: string
  onBack: () => void
  onClose?: () => void
  onDeleted?: () => void
  /** Whether the *current chat session* (if any) has this task attached. */
  attached?: boolean
  /** Disabled when there's no session to attach to (e.g. no project open). */
  canAttach?: boolean
  onAttach?: (taskId: string) => Promise<void> | void
  onDetach?: (taskId: string) => Promise<void> | void
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

export function TaskDetail({
  taskId,
  onBack,
  onClose,
  onDeleted,
  attached = false,
  canAttach = false,
  onAttach,
  onDetach,
}: Props) {
  const { updateTask, deleteTask } = useTasks()
  const { task, sources, loading, error, setTask, deleteSource } = useTaskDetail(taskId)
  const [attachBusy, setAttachBusy] = useState(false)

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
          <div className="task-detail__attach-row">
            {attached ? (
              <button
                type="button"
                className="task-panel__btn task-detail__attach-btn task-detail__attach-btn--detach"
                onClick={async () => {
                  if (!onDetach || attachBusy) return
                  setAttachBusy(true)
                  try {
                    await onDetach(task.id)
                  } finally {
                    setAttachBusy(false)
                  }
                }}
                disabled={!onDetach || attachBusy}
                title="이 세션에서 Task 분리 (이미 주입된 컨텍스트는 제거되지 않음)"
              >
                {attachBusy ? '...' : '🔗 분리'}
              </button>
            ) : (
              <button
                type="button"
                className="task-panel__btn task-panel__btn--primary task-detail__attach-btn"
                onClick={async () => {
                  if (!onAttach || attachBusy) return
                  setAttachBusy(true)
                  try {
                    await onAttach(task.id)
                  } finally {
                    setAttachBusy(false)
                  }
                }}
                disabled={!canAttach || !onAttach || attachBusy}
                title={
                  canAttach
                    ? '이 세션에 Task의 컨텍스트를 주입하고 attach'
                    : '현재 활성화된 세션이 없습니다'
                }
              >
                {attachBusy ? '...' : '📎 이 세션에 attach'}
              </button>
            )}
            {attached && (
              <span className="task-detail__attach-hint">
                이 세션에 attach됨
              </span>
            )}
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
                  채팅의 답변 옆 📥 버튼이나 선택 텍스트의 📥 캡처로 추가할 수 있습니다.
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
                        display: 'flex',
                        alignItems: 'center',
                        gap: 6,
                        fontSize: 10,
                        color: '#6e7681',
                        marginBottom: 4,
                      }}
                    >
                      <span style={{ flex: 1 }}>
                        {s.kind} · {formatTs(s.captured_at_ms)}
                      </span>
                      <button
                        type="button"
                        onClick={() => {
                          if (confirm('이 Source를 삭제하시겠습니까?')) {
                            void deleteSource(s.id)
                          }
                        }}
                        style={{
                          background: 'none',
                          border: 'none',
                          color: '#6e7681',
                          cursor: 'pointer',
                          fontSize: 14,
                          padding: '0 4px',
                        }}
                        title="Source 삭제"
                        aria-label="Source 삭제"
                      >
                        ×
                      </button>
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
