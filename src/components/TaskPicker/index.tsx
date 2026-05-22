import { useEffect, useRef, useState } from 'react'
import { useTasks } from '../../hooks/useTasks'
import type { Source, TaskSummary } from '../../types/task'
import { TaskList } from './TaskList'
import { useTaskCapture } from './useTaskCapture'
import { useTaskFilter } from './useTaskFilter'
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
  const filter = useTaskFilter(tasks)
  const { query, setQuery, filtered, focusIdx, setFocusIdx, focusNext, focusPrev } =
    filter
  const [newName, setNewName] = useState('')
  const searchRef = useRef<HTMLInputElement | null>(null)
  const capture = useTaskCapture({
    draft,
    tasks,
    createTask,
    createSource,
    onCaptured,
    onClose,
  })
  const { submitting, error, captureInto, createAndCapture } = capture

  // Fresh open: ensure list is fresh and focus the filter.
  useEffect(() => {
    void refresh()
    setTimeout(() => searchRef.current?.focus(), 0)
  }, [refresh])

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      onClose()
      return
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      focusNext()
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      focusPrev()
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
          <TaskList
            loaded={loaded}
            total={tasks.length}
            filtered={filtered}
            focusIdx={focusIdx}
            submitting={submitting}
            onFocus={setFocusIdx}
            onPick={(id) => void captureInto(id)}
          />
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
                  void createAndCapture(newName)
                }
              }}
            />
            <button
              type="button"
              className="task-picker__create-btn"
              onClick={() => void createAndCapture(newName)}
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
