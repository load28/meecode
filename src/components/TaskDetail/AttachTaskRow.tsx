import { useState } from 'react'

interface Props {
  taskId: string
  attached: boolean
  /** 활성 세션이 있어 attach가 가능한가. false면 attach 버튼 비활성. */
  canAttach: boolean
  onAttach?: (taskId: string) => Promise<void> | void
  onDetach?: (taskId: string) => Promise<void> | void
}

/**
 * Task 상세 화면에서 "이 세션에 attach / 분리" 버튼 + 안내 텍스트 한 줄.
 * 진행 중 상태(attachBusy)는 컴포넌트 내부에서 자체적으로 관리.
 */
export function AttachTaskRow({
  taskId,
  attached,
  canAttach,
  onAttach,
  onDetach,
}: Props) {
  const [busy, setBusy] = useState(false)

  const handleAttach = async () => {
    if (!onAttach || busy) return
    setBusy(true)
    try {
      await onAttach(taskId)
    } finally {
      setBusy(false)
    }
  }

  const handleDetach = async () => {
    if (!onDetach || busy) return
    setBusy(true)
    try {
      await onDetach(taskId)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="task-detail__attach-row">
      {attached ? (
        <button
          type="button"
          className="task-panel__btn task-detail__attach-btn task-detail__attach-btn--detach"
          onClick={handleDetach}
          disabled={!onDetach || busy}
          title="이 세션에서 Task 분리 (이미 주입된 컨텍스트는 제거되지 않음)"
        >
          {busy ? '...' : '🔗 분리'}
        </button>
      ) : (
        <button
          type="button"
          className="task-panel__btn task-panel__btn--primary task-detail__attach-btn"
          onClick={handleAttach}
          disabled={!canAttach || !onAttach || busy}
          title={
            canAttach
              ? '이 세션에 Task의 컨텍스트를 주입하고 attach'
              : '현재 활성화된 세션이 없습니다'
          }
        >
          {busy ? '...' : '📎 이 세션에 attach'}
        </button>
      )}
      {attached && (
        <span className="task-detail__attach-hint">이 세션에 attach됨</span>
      )}
    </div>
  )
}
