import { useState } from 'react'
import type { OrganizePreview, OrganizeStatus } from '../../types/task'

interface Props {
  status: OrganizeStatus
  preview: OrganizePreview | null
  lastNote: string | null
  /** Returns a non-null error string when the start failed. */
  onStart: () => Promise<string | null>
  onCancel: () => Promise<void> | void
}

/**
 * "정리 (Organize)" section: kicks off the backend organize job and
 * shows its progress/cancel affordances, the last activity note, and
 * any local error. The button is disabled when nothing's pending,
 * already running, or while the start request itself is in-flight.
 */
export function OrganizeSection({
  status,
  preview,
  lastNote,
  onStart,
  onCancel,
}: Props) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleStart = async () => {
    setBusy(true)
    setError(null)
    try {
      const err = await onStart()
      if (err) setError(err)
    } finally {
      setBusy(false)
    }
  }

  const unprocessed = preview?.unprocessed_count ?? 0
  const startDisabled = busy || status === 'running' || unprocessed === 0

  return (
    <div className="task-detail__section">
      <h3 className="task-detail__section-title">정리 (Organize)</h3>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <button
          type="button"
          className="task-panel__btn task-panel__btn--primary"
          onClick={handleStart}
          disabled={startDisabled}
          title={
            preview?.resume_session_id
              ? '기존 Claude Code 세션을 resume — 캐시 활용'
              : '새 Claude Code 세션 시작'
          }
        >
          {status === 'running'
            ? '🔄 정리 중...'
            : `🪄 정리 (${unprocessed}개 새 source)`}
        </button>
        {status === 'running' && (
          <button
            type="button"
            className="task-panel__btn"
            onClick={() => {
              void onCancel()
            }}
          >
            취소
          </button>
        )}
        {preview?.resume_session_id && (
          <span style={{ fontSize: 10, color: '#6e7681' }}>
            ↺ 캐시 가능
          </span>
        )}
      </div>
      {lastNote && (
        <div style={{ fontSize: 11, color: '#8b949e', marginTop: 6 }}>
          {lastNote}
        </div>
      )}
      {error && (
        <div className="task-detail__error" style={{ margin: '6px 0 0' }}>
          {error}
        </div>
      )}
    </div>
  )
}
