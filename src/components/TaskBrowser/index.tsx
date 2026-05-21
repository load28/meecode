import { useState } from 'react'
import { useTasks } from '../../hooks/useTasks'
import { TaskDetail } from '../TaskDetail'
import './TaskBrowser.css'

interface Props {
  onClose?: () => void
}

function relativeTimeKr(ms: number): string {
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

export function TaskBrowser({ onClose }: Props) {
  const { tasks, loaded, createTask, refresh } = useTasks()
  // Two-way view: list <-> detail. Detail mounts when a task is selected.
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const [newName, setNewName] = useState('')
  const [newDesc, setNewDesc] = useState('')
  const [submitting, setSubmitting] = useState(false)

  const handleCreate = async () => {
    const name = newName.trim()
    if (!name) return
    setSubmitting(true)
    try {
      const created = await createTask(name, newDesc.trim() || undefined)
      if (created) {
        setNewName('')
        setNewDesc('')
        setCreating(false)
        setSelectedId(created.id)
      }
    } finally {
      setSubmitting(false)
    }
  }

  const handleCancelCreate = () => {
    setCreating(false)
    setNewName('')
    setNewDesc('')
  }

  if (selectedId) {
    return (
      <TaskDetail
        taskId={selectedId}
        onBack={() => {
          setSelectedId(null)
          // Refetch so source_count / updated_at in the list reflect any
          // edits done inside detail view.
          void refresh()
        }}
        onClose={onClose}
        onDeleted={() => {
          setSelectedId(null)
          void refresh()
        }}
      />
    )
  }

  return (
    <div className="task-panel">
      <div className="task-panel__header">
        <h2 className="task-panel__title">Tasks</h2>
        <button
          type="button"
          className="task-panel__new-btn"
          onClick={() => setCreating((v) => !v)}
        >
          {creating ? '취소' : '+ 새 Task'}
        </button>
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
      {creating && (
        <div className="task-panel__create">
          <input
            className="task-panel__create-input"
            placeholder="Task 이름"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            autoFocus
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                void handleCreate()
              }
            }}
          />
          <textarea
            className="task-panel__create-textarea"
            placeholder="설명 (선택)"
            value={newDesc}
            onChange={(e) => setNewDesc(e.target.value)}
          />
          <div className="task-panel__create-actions">
            <button
              type="button"
              className="task-panel__btn"
              onClick={handleCancelCreate}
            >
              취소
            </button>
            <button
              type="button"
              className="task-panel__btn task-panel__btn--primary"
              onClick={handleCreate}
              disabled={submitting || !newName.trim()}
            >
              {submitting ? '생성 중...' : '생성'}
            </button>
          </div>
        </div>
      )}
      <div className="task-panel__body">
        {!loaded ? (
          <div className="task-panel__empty">
            <p>불러오는 중...</p>
          </div>
        ) : tasks.length === 0 ? (
          <div className="task-panel__empty">
            <p>Task가 없습니다.</p>
            <p style={{ fontSize: 12, color: '#6e7681' }}>
              위의 + 새 Task 버튼으로 만들어보세요.
            </p>
          </div>
        ) : (
          <ul className="task-panel__list">
            {tasks.map((t) => (
              <li key={t.id} className="task-panel__item">
                <button
                  type="button"
                  className="task-panel__item-btn"
                  onClick={() => setSelectedId(t.id)}
                >
                  <div className="task-panel__item-name">{t.name}</div>
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
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
