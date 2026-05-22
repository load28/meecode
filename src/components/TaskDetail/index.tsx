import { useEffect, useState } from 'react'
import {
  useTasks,
  useTaskDetail,
  useTaskOrganize,
  useTaskWiki,
} from '../../hooks/useTasks'
import { TaskDetailHeader } from './TaskDetailHeader'
import { TaskEditableFields } from './TaskEditableFields'
import { SourcesSection } from './SourcesSection'
import { OrganizeSection } from './OrganizeSection'
import { WikiSection } from './WikiSection'
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
  const { task, sources, loading, error, setTask, deleteSource, refresh: refreshDetail } =
    useTaskDetail(taskId)
  const wiki = useTaskWiki(taskId)
  const organize = useTaskOrganize(taskId)
  const [attachBusy, setAttachBusy] = useState(false)

  // When organize completes, refresh sources (processed badges) and wiki list.
  useEffect(() => {
    if (organize.status === 'idle' && organize.lastProcessedSourceIds.length > 0) {
      void refreshDetail()
      void wiki.refresh()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [organize.status, organize.lastProcessedSourceIds])

  const commitName = async (next: string) => {
    if (!task) return
    const updated = await updateTask(task.id, { name: next })
    if (updated) setTask(updated)
  }

  const commitDesc = async (next: string) => {
    if (!task) return
    const updated = await updateTask(task.id, { description: next })
    if (updated) setTask(updated)
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
      <TaskDetailHeader
        title={task?.name ?? (loading ? '불러오는 중...' : 'Task')}
        onBack={onBack}
        onClose={onClose}
      />
      {error && <div className="task-detail__error">{error}</div>}
      {task && (
        <>
          <TaskEditableFields
            task={task}
            onCommitName={commitName}
            onCommitDescription={commitDesc}
          />
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
          <SourcesSection
            sources={sources}
            onDelete={(id) => void deleteSource(id)}
            formatTimestamp={formatTs}
          />
          <OrganizeSection
            status={organize.status}
            preview={organize.preview}
            lastNote={organize.lastNote}
            onStart={organize.start}
            onCancel={organize.cancel}
          />
          <WikiSection
            taskId={task.id}
            files={wiki.files}
            readFile={wiki.readFile}
            writeFile={wiki.writeFile}
            deleteFile={wiki.deleteFile}
          />
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
