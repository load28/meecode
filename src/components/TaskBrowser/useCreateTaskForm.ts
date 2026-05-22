import { useState } from 'react'
import type { Task } from '../../types/task'
import type { UseTasksResult } from '../../hooks/useTasks'

interface Options {
  createTask: UseTasksResult['createTask']
  /** 생성 성공 시 새 Task로 자동 이동. */
  onCreated: (task: Task) => void
}

export interface UseCreateTaskFormResult {
  open: boolean
  /** 폼이 열려있을 때 입력 중인 이름. */
  name: string
  description: string
  submitting: boolean
  setName: (next: string) => void
  setDescription: (next: string) => void
  /** "+ 새 Task" 버튼 — 열기/닫기 토글. 닫을 때는 입력값도 비운다. */
  toggle: () => void
  /** 명시적 취소 — open=false + 입력값 reset. */
  cancel: () => void
  /** 이름이 비어있지 않을 때만 createTask를 호출. */
  submit: () => Promise<void>
}

/**
 * TaskBrowser 상단의 "+ 새 Task" 인라인 폼 상태 머신.
 *
 * 폼은 한 번에 열려/닫혀 있으며 — 닫혀있으면 이름/설명 입력값은 따라서
 * 초기화된다. 생성 성공 시 onCreated 콜백으로 부모에게 새 Task를 통보하고
 * 폼은 자동으로 닫힌다.
 */
export function useCreateTaskForm({
  createTask,
  onCreated,
}: Options): UseCreateTaskFormResult {
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [submitting, setSubmitting] = useState(false)

  const reset = () => {
    setName('')
    setDescription('')
  }

  const toggle = () => {
    setOpen((v) => {
      if (v) reset()
      return !v
    })
  }

  const cancel = () => {
    setOpen(false)
    reset()
  }

  const submit = async () => {
    const trimmed = name.trim()
    if (!trimmed) return
    setSubmitting(true)
    try {
      const created = await createTask(trimmed, description.trim() || undefined)
      if (created) {
        reset()
        setOpen(false)
        onCreated(created)
      }
    } finally {
      setSubmitting(false)
    }
  }

  return {
    open,
    name,
    description,
    submitting,
    setName,
    setDescription,
    toggle,
    cancel,
    submit,
  }
}
