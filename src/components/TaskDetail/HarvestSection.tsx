import { useState } from 'react'
import type { HarvestStatus } from '../../types/task'

interface Props {
  status: HarvestStatus
  lastNote: string | null
  error: string | null
  /** True when a session is open. Harvest reads that session's transcript,
   *  so it's only meaningful — and only allowed — then. */
  canHarvest: boolean
  /** Returns a non-null error string when the start request itself failed. */
  onStart: () => Promise<string | null>
  onCancel: () => Promise<void> | void
}

/**
 * "세션 → 위키" section: distills the currently open session's transcript
 * into Sources, which then auto-organize into the Wiki. Disabled unless a
 * session is open, since there'd be no transcript to read otherwise.
 */
export function HarvestSection({
  status,
  lastNote,
  error,
  canHarvest,
  onStart,
  onCancel,
}: Props) {
  const [busy, setBusy] = useState(false)
  const [localErr, setLocalErr] = useState<string | null>(null)

  const handleStart = async () => {
    setBusy(true)
    setLocalErr(null)
    try {
      const err = await onStart()
      if (err) setLocalErr(err)
    } finally {
      setBusy(false)
    }
  }

  const running = status === 'running'
  const startDisabled = busy || running || !canHarvest
  const shownError = localErr ?? (status === 'error' ? error : null)

  return (
    <div className="task-detail__section">
      <h3 className="task-detail__section-title">세션에서 수집 (Harvest)</h3>
      <div className="task-detail__organize-row">
        <button
          type="button"
          className="task-panel__btn task-panel__btn--primary"
          onClick={handleStart}
          disabled={startDisabled}
          title={
            canHarvest
              ? '현재 세션 대화를 Source로 추출하고 위키까지 자동 정리'
              : '현재 활성화된 세션이 없습니다'
          }
        >
          {running ? '🔄 세션 분석 중...' : '🌾 세션을 위키로 정리'}
        </button>
        {running && (
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
      </div>
      {!canHarvest && (
        <div className="task-detail__organize-hint">
          현재 활성화된 세션이 있어야 수집할 수 있습니다.
        </div>
      )}
      {lastNote && <div className="task-detail__organize-note">{lastNote}</div>}
      {shownError && (
        <div className="task-detail__error task-detail__error--inline">
          {shownError}
        </div>
      )}
    </div>
  )
}
