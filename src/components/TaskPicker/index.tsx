import { useEffect, useRef, useState } from 'react'
import { useTasks } from '../../hooks/useTasks'
import type { Source, TaskSummary } from '../../types/task'
import { TaskList } from './TaskList'
import { PickerHeader } from './PickerHeader'
import { CreateTaskRow } from './CreateTaskRow'
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
        <PickerHeader previewText={draft.content || null} onClose={onClose} />
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
        <CreateTaskRow
          name={newName}
          submitting={submitting}
          onNameChange={setNewName}
          onSubmit={() => void createAndCapture(newName)}
        />
      </div>
    </div>
  )
}
