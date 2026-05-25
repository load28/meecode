import { useEffect } from 'react'
import {
  useTasks,
  useTaskDetail,
  useTaskOrganize,
  useTaskWiki,
  useTaskHarvest,
} from '../../hooks/useTasks'
import type { ContentTab } from '../../hooks/useFileTabs'
import { sourceTitle } from '../../utils/sourceTitle'
import { LOADING } from '../../utils/messages'
import { TaskDetailHeader } from './TaskDetailHeader'
import { TaskEditableFields } from './TaskEditableFields'
import { AttachTaskRow } from './AttachTaskRow'
import { SourcesSection } from './SourcesSection'
import { HarvestSection } from './HarvestSection'
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
  /** Active session id + its project path — needed to harvest the session
   *  transcript into Sources. Harvest is gated on `attached`. */
  sessionId?: string | null
  projectPath?: string
  /** Open a captured source (no backing file) in the shared file viewer. */
  onOpenContent?: (tab: ContentTab) => void
  /** Open a real file from disk (e.g. a wiki file) in the shared file viewer. */
  onOpenFile?: (path: string) => void
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
  sessionId,
  projectPath,
  onOpenContent,
  onOpenFile,
}: Props) {
  const { updateTask, deleteTask } = useTasks()
  const { task, sources, loading, error, setTask, deleteSource, refresh: refreshDetail } =
    useTaskDetail(taskId)
  const wiki = useTaskWiki(taskId)
  const organize = useTaskOrganize(taskId)
  const harvest = useTaskHarvest(taskId)
  // When organize completes, refresh sources (processed badges) and wiki list.
  useEffect(() => {
    if (organize.status === 'idle' && organize.lastProcessedSourceIds.length > 0) {
      void refreshDetail()
      void wiki.refresh()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [organize.status, organize.lastProcessedSourceIds])
  // When a harvest run finishes it has just written new Sources — surface them
  // immediately (the organize chain it triggers will refresh again on done).
  useEffect(() => {
    if (harvest.doneTick > 0) {
      void refreshDetail()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [harvest.doneTick])

  const canHarvest = attached && !!sessionId

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
        title={task?.name ?? (loading ? LOADING : 'Task')}
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
          <AttachTaskRow
            taskId={task.id}
            attached={attached}
            canAttach={canAttach}
            onAttach={onAttach}
            onDetach={onDetach}
          />
          <SourcesSection
            sources={sources}
            onDelete={(id) => void deleteSource(id)}
            formatTimestamp={formatTs}
            onOpen={
              onOpenContent
                ? (s) =>
                    onOpenContent({
                      key: `task-source:${s.task_id}:${s.id}`,
                      title: sourceTitle(s),
                      content: s.content,
                      language: 'markdown',
                    })
                : undefined
            }
          />
          <HarvestSection
            status={harvest.status}
            lastNote={harvest.lastNote}
            error={harvest.error}
            canHarvest={canHarvest}
            onStart={() =>
              canHarvest
                ? harvest.start(sessionId!, projectPath ?? '')
                : Promise.resolve('세션에 attach된 Task가 아닙니다.')
            }
            onCancel={harvest.cancel}
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
            onOpenFile={onOpenFile}
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
