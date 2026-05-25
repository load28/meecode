import { useState } from 'react'
import { useTasks } from '../../hooks/useTasks'
import type { ContentTab } from '../../hooks/useFileTabs'
import { TaskDetail } from '../TaskDetail'
import { CreateTaskForm } from './CreateTaskForm'
import { TaskBrowserList } from './TaskBrowserList'
import { useCreateTaskForm } from './useCreateTaskForm'
import './TaskBrowser.css'

interface Props {
  onClose?: () => void
  /** Active session id, if any — drives the "attached" badges and the
   *  attach/detach button in TaskDetail. */
  sessionId?: string | null
  /** Current project path — needed for harvesting the session transcript. */
  projectPath?: string
  attachedTaskIds?: Set<string>
  /** Performs the real attach (binding + context injection). null when no session. */
  onAttachTask?: (taskId: string) => Promise<void> | void
  onDetachTask?: (taskId: string) => Promise<void> | void
  /** Open a captured source (no backing file) in the shared file viewer. */
  onOpenContent?: (tab: ContentTab) => void
  /** Open a real file from disk (e.g. a wiki file) in the shared file viewer. */
  onOpenFile?: (path: string) => void
}

export function TaskBrowser({
  onClose,
  sessionId,
  projectPath,
  attachedTaskIds,
  onAttachTask,
  onDetachTask,
  onOpenContent,
  onOpenFile,
}: Props) {
  const { tasks, loaded, createTask, refresh } = useTasks()
  // Two-way view: list <-> detail. Detail mounts when a task is selected.
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const form = useCreateTaskForm({
    createTask,
    onCreated: (t) => setSelectedId(t.id),
  })

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
        sessionId={sessionId}
        projectPath={projectPath}
        onOpenContent={onOpenContent}
        onOpenFile={onOpenFile}
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
          onClick={form.toggle}
        >
          {form.open ? '취소' : '+ 새 Task'}
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
      {form.open && (
        <CreateTaskForm
          name={form.name}
          description={form.description}
          submitting={form.submitting}
          onNameChange={form.setName}
          onDescriptionChange={form.setDescription}
          onCancel={form.cancel}
          onSubmit={() => void form.submit()}
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
