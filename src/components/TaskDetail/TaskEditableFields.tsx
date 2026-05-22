import { useEffect, useState } from 'react'
import type { Task } from '../../types/task'

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

interface Props {
  task: Task
  /**
   * Persist a name change. Called on blur (or Enter, which blurs).
   * The hook never calls this with an unchanged or empty-after-trim
   * value — that case is handled internally by reverting the input.
   */
  onCommitName: (next: string) => void
  /** Persist a description change. Called on blur with the local buffer. */
  onCommitDescription: (next: string) => void
}

/**
 * Editable name + description fields with the created/updated meta row.
 *
 * Edits stay local until the input is blurred, so every keystroke isn't
 * an IPC roundtrip + disk write. The local buffer resets when the
 * underlying task.id changes (the parent navigates to a different task).
 */
export function TaskEditableFields({
  task,
  onCommitName,
  onCommitDescription,
}: Props) {
  const [name, setName] = useState(task.name)
  const [desc, setDesc] = useState(task.description)

  useEffect(() => {
    setName(task.name)
    setDesc(task.description)
  }, [task.id])

  const commitName = () => {
    const trimmed = name.trim()
    if (!trimmed || trimmed === task.name) {
      setName(task.name)
      return
    }
    onCommitName(trimmed)
  }

  const commitDesc = () => {
    if (desc === task.description) return
    onCommitDescription(desc)
  }

  return (
    <>
      <div className="task-detail__field">
        <label className="task-detail__label" htmlFor="task-detail-name">
          이름
        </label>
        <input
          id="task-detail-name"
          className="task-detail__name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onBlur={commitName}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              ;(e.target as HTMLInputElement).blur()
            }
          }}
        />
      </div>
      <div className="task-detail__field">
        <label className="task-detail__label" htmlFor="task-detail-desc">
          설명
        </label>
        <textarea
          id="task-detail-desc"
          className="task-detail__desc"
          value={desc}
          onChange={(e) => setDesc(e.target.value)}
          onBlur={commitDesc}
          placeholder="이 Task가 무엇에 대한 작업인지 적어두세요"
        />
      </div>
      <div className="task-detail__meta">
        <span>생성 {formatTs(task.created_at_ms)}</span>
        <span>수정 {formatTs(task.updated_at_ms)}</span>
      </div>
    </>
  )
}
