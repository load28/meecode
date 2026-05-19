import { QaCard } from '../QaCard'
import { ToolApprovalCard } from '../ToolApprovalCard'
import { useStickyScroll } from '../../hooks/useStickyScroll'
import { useSpinnerVerb } from '../../utils/spinnerVerbs'
import type { QaPair, ToolRequest } from '../../types'
import type { TaskActivity } from '../../state/sessionStore'
import './ChatStream.css'

interface Props {
  pairs: QaPair[]
  onExpand: (id: string) => void
  pendingTool: ToolRequest | null
  onRespondTool: (
    requestId: string,
    allow: boolean,
    toolUseId: string | null,
    updatedInput?: unknown,
  ) => void
  onOpenFile?: (path: string) => void
  taskActivity?: TaskActivity | null
  /** Hook activity label from useClaudeSession. Surfaced as a badge below the stream. */
  hookActivity?: string | null
  /**
   * Whether the agent loop is still running. Gates the bottom StatusIndicator
   * so it disappears once `session:turn_end` clears the flag — otherwise the
   * gerund spinner would linger forever after the final assistant text.
   */
  turnInProgress?: boolean
}

export function ChatStream({
  pairs,
  onExpand,
  pendingTool,
  onRespondTool,
  onOpenFile,
  taskActivity,
  hookActivity,
  turnInProgress = false,
}: Props) {
  const { ref: scrollRef, onScroll: handleScroll } =
    useStickyScroll<HTMLDivElement>([pairs, pendingTool])

  const last = pairs[pairs.length - 1]
  const lastSeg = last?.segments[last.segments.length - 1]
  // Compute the indicator override. Tool name takes priority over the
  // generic gerund rotation — when claude is running Read/Bash/Edit, the
  // user wants to see "Read" not "Cogitating".
  const override: string | null =
    !pendingTool && last
      ? last.segments.length === 0
        ? null // free gerund rotation while still empty
        : lastSeg && lastSeg.kind === 'tool_use'
        ? `${lastSeg.name}`
        : null
      : null
  const showIndicator = turnInProgress && !pendingTool && last !== undefined

  if (pairs.length === 0 && !pendingTool) {
    return (
      <div className="chat-stream chat-stream--empty">
        <p>프로젝트가 시작되었습니다. 아래에서 첫 질문을 입력하세요.</p>
      </div>
    )
  }

  return (
    <div ref={scrollRef} className="chat-stream" onScroll={handleScroll}>
      {pairs.map((p) =>
        p.id.startsWith('compact-') ? (
          <div key={p.id} className="chat-stream__compact" role="separator">
            <span>{p.user_text}</span>
          </div>
        ) : (
          <QaCard
            key={p.id}
            pair={p}
            onExpand={() => onExpand(p.id)}
            onOpenFile={onOpenFile}
          />
        ),
      )}
      {pendingTool && (
        <ToolApprovalCard
          request={pendingTool}
          onRespond={(allow, updatedInput) =>
            onRespondTool(
              pendingTool.request_id,
              allow,
              pendingTool.tool_use_id,
              updatedInput,
            )
          }
        />
      )}
      {showIndicator && (
        <StatusIndicator
          override={override}
          taskActivity={taskActivity ?? null}
          hookActivity={hookActivity ?? null}
        />
      )}
    </div>
  )
}

function StatusIndicator({
  override,
  taskActivity,
  hookActivity,
}: {
  override: string | null
  taskActivity: TaskActivity | null
  hookActivity: string | null
}) {
  const verb = useSpinnerVerb({ override })
  const detail = taskActivity?.description ?? hookActivity ?? null
  return (
    <div className="chat-stream__status" role="status" aria-live="polite">
      <span className="chat-stream__spinner" aria-hidden="true" />
      <span className="chat-stream__status-label">{verb}…</span>
      {detail && <span className="chat-stream__status-detail">{detail}</span>}
      <span className="chat-stream__status-dots" aria-hidden="true">
        <span />
        <span />
        <span />
      </span>
    </div>
  )
}
