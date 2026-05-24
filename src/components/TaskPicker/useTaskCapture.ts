import { useState } from 'react'
import type { Source, Task, TaskSummary } from '../../types/task'
import type { CreateSourceInput, UseTasksResult } from '../../hooks/useTasks'
import type { CaptureDraft } from './index'

interface Options {
  draft: CaptureDraft
  /** Title to persist with the Source — supplied (and editable) by the picker. */
  title: string
  tasks: TaskSummary[]
  createTask: UseTasksResult['createTask']
  createSource: UseTasksResult['createSource']
  onCaptured?: (source: Source, task: TaskSummary) => void
  onClose: () => void
}

export interface UseTaskCaptureResult {
  submitting: boolean
  error: string | null
  /** 기존 Task에 capture. */
  captureInto: (taskId: string) => Promise<void>
  /** 새 Task를 만들고 그 자리에 capture. */
  createAndCapture: (name: string) => Promise<void>
}

/**
 * TaskPicker의 두 가지 캡처 흐름(기존 Task / 새 Task)을 한 곳에 묶은
 * 훅. 둘 다 createSource로 Source를 만들고 onCaptured(source, task)를
 * 통보한 뒤 picker를 닫는다.
 *
 * 새 Task는 createTask 직후 taskStore에 추가되지만 부모의 tasks 배열
 * 갱신은 다음 렌더에 일어나므로, createAndCapture 안에서는 lookup
 * 없이 createTask 결과를 그대로 사용한다.
 */
export function useTaskCapture({
  draft,
  title,
  tasks,
  createTask,
  createSource,
  onCaptured,
  onClose,
}: Options): UseTaskCaptureResult {
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const draftInput = (taskId: string): CreateSourceInput => ({
    taskId,
    kind: draft.kind,
    title: title.trim(),
    content: draft.content,
    sessionId: draft.sessionId,
    qaId: draft.qaId,
    projectPath: draft.projectPath,
  })

  const captureInto = async (taskId: string) => {
    setSubmitting(true)
    setError(null)
    try {
      const created = await createSource(draftInput(taskId))
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

  const taskToSummary = (t: Task): TaskSummary => ({
    id: t.id,
    name: t.name,
    description: t.description,
    created_at_ms: t.created_at_ms,
    updated_at_ms: t.updated_at_ms,
    source_count: 1,
  })

  const createAndCapture = async (rawName: string) => {
    const name = rawName.trim()
    if (!name) return
    setSubmitting(true)
    setError(null)
    try {
      const t = await createTask(name)
      if (!t) {
        setError('Task 생성에 실패했습니다.')
        return
      }
      const src = await createSource(draftInput(t.id))
      if (!src) {
        setError('Source 생성에 실패했습니다.')
        return
      }
      onCaptured?.(src, taskToSummary(t))
      onClose()
    } finally {
      setSubmitting(false)
    }
  }

  return { submitting, error, captureInto, createAndCapture }
}
