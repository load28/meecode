import { useState } from 'react'
import { useTasks } from '../../hooks/useTasks'
import { TaskDetail } from '../TaskDetail'
import { CreateTaskForm } from './CreateTaskForm'
import { TaskBrowserList } from './TaskBrowserList'
import './TaskBrowser.css'

interface Props {
  onClose?: () => void
  /** Active session id, if any — drives the "attached" badges and the
   *  attach/detach button in TaskDetail. */
  sessionId?: string | null
  attachedTaskIds?: Set<string>
  /** Performs the real attach (binding + context injection). null when no session. */
  onAttachTask?: (taskId: string) => Promise<void> | void
  onDetachTask?: (taskId: string) => Promise<void> | void
}

export function TaskBrowser({
  onClose,
  sessionId,
  attachedTaskIds,
  onAttachTask,
  onDetachTask,
}: Props) {
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
        attached={attachedTaskIds?.has(selectedId) ?? false}
        canAttach={!!sessionId}
        onAttach={onAttachTask}
        onDetach={onDetachTask}
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
        <CreateTaskForm
          name={newName}
          description={newDesc}
          submitting={submitting}
          onNameChange={setNewName}
          onDescriptionChange={setNewDesc}
          onCancel={handleCancelCreate}
          onSubmit={() => void handleCreate()}
        />
      )}
      <div className="task-panel__body">
        <TaskBrowserList
          loaded={loaded}
          tasks={tasks}
          attachedTaskIds={attachedTaskIds}
          onSelect={setSelectedId}
        />
      </div>
    </div>
  )
}
