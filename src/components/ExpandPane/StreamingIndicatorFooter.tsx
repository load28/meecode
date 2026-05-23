import { StatusIndicator, computeTurnIndicator } from '../StatusIndicator'
import type { QaPair, ToolRequest } from '../../types'
import type { TaskActivity } from '../../state/sessionStore'

interface Props {
  pairs: QaPair[] | undefined
  pendingTool: ToolRequest | null | undefined
  turnInProgress: boolean | undefined
  taskActivity: TaskActivity | null | undefined
  hookActivity: string | null | undefined
}

/**
 * ExpandPane 본문 하단의 스트리밍 인디케이터 — 현재 펼쳐 보고 있는 pair가
 * 아니라 세션의 in-flight pair(pairs의 마지막)에서 표시 여부와 override를
 * 가져온다. pair가 선택되지 않은 상태에서도 보이도록 pair 조건 바깥에서
 * 렌더된다.
 */
export function StreamingIndicatorFooter({
  pairs,
  pendingTool,
  turnInProgress,
  taskActivity,
  hookActivity,
}: Props) {
  if (!pairs || pairs.length === 0) return null
  const { show, override } = computeTurnIndicator(
    pairs,
    pendingTool ?? null,
    turnInProgress ?? false,
  )
  if (!show) return null
  return (
    <StatusIndicator
      override={override}
      taskActivity={taskActivity ?? null}
      hookActivity={hookActivity ?? null}
      className="status-indicator--inline"
    />
  )
}
