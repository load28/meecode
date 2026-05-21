import { useEffect, useMemo, useRef, useState } from 'react'
import { useTasks } from '../../hooks/useTasks'
import type { Source, TaskSummary } from '../../types/task'
import './TaskPicker.css'

/** A pending capture — the content + origin gathered at the click site,
 *  waiting for the user to pick which Task to attach it to. */
export interface CaptureDraft {
  kind: 'qa_block' | 'selection' | 'manual'
  content: string
  sessionId?: string | null
  qaId?: string | null
  projectPath?: string | null
}

interface Props {
  draft: CaptureDraft
  onClose: () => void
  onCaptured?: (source: Source, task: TaskSummary) => void
}

function previewLine(text: string): string {
  const first = text.split('\n').find((l) => l.trim()) ?? text
  return first.length > 80 ? `${first.slice(0, 80)}…` : first
}

export function TaskPicker({ draft, onClose, onCaptured }: Props) {
  const { tasks, loaded, refresh, createTask, createSource } = useTasks()
  const [query, setQuery] = useState('')
  const [newName, setNewName] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [focusIdx, setFocusIdx] = useState(0)
  const searchRef = useRef<HTMLInputElement | null>(null)

  // Fresh open: ensure list is fresh and focus the filter.
  useEffect(() => {
    void refresh()
    setTimeout(() => searchRef.current?.focus(), 0)
  }, [refresh])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return tasks
    return tasks.filter(
      (t) =>
        t.name.toLowerCase().includes(q) ||
        t.description.toLowerCase().includes(q),
    )
  }, [tasks, query])

  // Keep keyboard focus index in range as the filter changes.
  useEffect(() => {
    if (focusIdx >= filtered.length) setFocusIdx(Math.max(0, filtered.length - 1))
  }, [filtered.length, focusIdx])

  const captureInto = async (taskId: string) => {
    setSubmitting(true)
    setError(null)
    try {
      const created = await createSource({
        taskId,
        kind: draft.kind,
        content: draft.content,
        sessionId: draft.sessionId,
        qaId: draft.qaId,
        projectPath: draft.projectPath,
      })
      if (!created) {
        setError('Source 생성에 실패했습니다.')
        return
      }
      const task = tasks.find((t) => t.id === taskId)
      if (task && onCaptured) onCaptured(created, task)
      onClose()
    } finally {
      setSubmitting(false)
    }
  }

  const handleCreateAndCapture = async () => {
    const name = newName.trim()
    if (!name) return
    setSubmitting(true)
    setError(null)
    try {
      const t = await createTask(name)
      if (!t) {
        setError('Task 생성에 실패했습니다.')
        return
      }
      // Reuse captureInto's flow but bypass the tasks lookup (the store
      // refresh hasn't completed yet, so `tasks` doesn't include `t`).
      const src = await createSource({
        taskId: t.id,
        kind: draft.kind,
        content: draft.content,
        sessionId: draft.sessionId,
        qaId: draft.qaId,
        projectPath: draft.projectPath,
      })
      if (!src) {
        setError('Source 생성에 실패했습니다.')
        return
      }
      onCaptured?.(src, {
        id: t.id,
        name: t.name,
        description: t.description,
        created_at_ms: t.created_at_ms,
        updated_at_ms: t.updated_at_ms,
        source_count: 1,
      })
      onClose()
    } finally {
      setSubmitting(false)
    }
  }

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      onClose()
      return
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setFocusIdx((i) => Math.min(filtered.length - 1, i + 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setFocusIdx((i) => Math.max(0, i - 1))
    } else if (e.key === 'Enter') {
      const target = filtered[focusIdx]
      if (target && !submitting) {
        e.preventDefault()
        void captureInto(target.id)
      }
    }
  }

  return (
    <div
      className="task-picker__backdrop"
      onClick={(e) => {
        // Click outside the dialog closes it; clicks inside (e.g. on the
        // search input or a list row) are stopped by the inner stopPropagation.
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div
        className="task-picker"
        role="dialog"
        aria-label="Task 선택"
        onKeyDown={onKeyDown}
      >
        <div className="task-picker__header">
          <h2 className="task-picker__title">Task에 캡처</h2>
          {draft.content && (
            <span
              className="task-picker__preview"
              title={draft.content.slice(0, 240)}
            >
              {previewLine(draft.content)}
            </span>
          )}
          <button
            type="button"
            className="task-picker__close"
            onClick={onClose}
            aria-label="닫기"
          >
            ×
          </button>
        </div>
        <input
          ref={searchRef}
          className="task-picker__search"
          placeholder="Task 검색..."
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        {error && <div className="task-picker__error">{error}</div>}
        <div className="task-picker__body">
          {!loaded ? (
            <div className="task-picker__empty">불러오는 중...</div>
          ) : filtered.length === 0 ? (
            <div className="task-picker__empty">
              {tasks.length === 0
                ? '아직 Task가 없습니다. 아래에서 만들어보세요.'
                : '검색 결과 없음'}
            </div>
          ) : (
            <ul className="task-picker__list">
              {filtered.map((t, i) => (
                <li key={t.id}>
                  <button
                    type="button"
                    className={`task-picker__item${
                      i === focusIdx ? ' is-focused' : ''
                    }`}
                    onClick={() => captureInto(t.id)}
                    onMouseEnter={() => setFocusIdx(i)}
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
          )}
        </div>
        <div className="task-picker__create">
          <div className="task-picker__create-row">
            <input
              className="task-picker__create-input"
              placeholder="+ 새 Task 이름"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  void handleCreateAndCapture()
                }
              }}
            />
            <button
              type="button"
              className="task-picker__create-btn"
              onClick={handleCreateAndCapture}
              disabled={submitting || !newName.trim()}
            >
              {submitting ? '...' : '생성 + 캡처'}
            </button>
          </div>
          <p className="task-picker__hint">
            ↑↓ 이동 · Enter 캡처 · Esc 닫기
          </p>
        </div>
      </div>
    </div>
  )
}
