import { useState } from 'react'

interface Props {
  taskId: string
  /** 활성 세션이 있어 주입이 가능한가. false면 버튼 비활성. */
  canInject: boolean
  onInject?: (taskId: string) => Promise<void> | void
}

/**
 * Task 상세 화면에서 "이 세션에 컨텍스트 주입" 버튼.
 *
 * 세션에 묶는(binding) 개념 없이, 누를 때마다 현재 열려 있는 세션으로 이
 * Task의 컨텍스트를 한 번 주입한다. 진행 중 상태는 컴포넌트 내부에서 관리.
 */
export function InjectContextRow({ taskId, canInject, onInject }: Props) {
  const [busy, setBusy] = useState(false)

  const handleInject = async () => {
    if (!onInject || busy) return
    setBusy(true)
    try {
      await onInject(taskId)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="task-detail__attach-row">
      <button
        type="button"
        className="task-panel__btn task-panel__btn--primary task-detail__attach-btn"
        onClick={handleInject}
        disabled={!canInject || !onInject || busy}
        title={
          canInject
            ? '현재 세션에 이 Task의 컨텍스트를 주입'
            : '현재 활성화된 세션이 없습니다'
        }
      >
        {busy ? '...' : '📎 이 세션에 컨텍스트 주입'}
      </button>
    </div>
  )
}
