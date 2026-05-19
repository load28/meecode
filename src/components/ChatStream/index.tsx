import { QaCard } from '../QaCard'
import { ToolApprovalCard } from '../ToolApprovalCard'
import { useStickyScroll } from '../../hooks/useStickyScroll'
import type { QaPair, ToolRequest } from '../../types'
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
}

export function ChatStream({
  pairs,
  onExpand,
  pendingTool,
  onRespondTool,
  onOpenFile,
}: Props) {
  const { ref: scrollRef, onScroll: handleScroll } =
    useStickyScroll<HTMLDivElement>([pairs, pendingTool])

  if (pairs.length === 0 && !pendingTool) {
    return (
      <div className="chat-stream chat-stream--empty">
        <p>프로젝트가 시작되었습니다. 아래에서 첫 질문을 입력하세요.</p>
      </div>
    )
  }

  const last = pairs[pairs.length - 1]
  const lastSeg = last?.segments[last.segments.length - 1]
  const indicatorLabel: string | null =
    !pendingTool && last
      ? last.segments.length === 0
        ? 'Thinking'
        : lastSeg && lastSeg.kind === 'tool_use'
        ? `${lastSeg.name} running`
        : lastSeg && lastSeg.kind === 'thinking'
        ? 'Reasoning'
        : null
      : null

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
      {indicatorLabel && (
        <div className="chat-stream__status" role="status" aria-live="polite">
          <span className="chat-stream__spinner" aria-hidden="true" />
          <span className="chat-stream__status-label">{indicatorLabel}</span>
          <span className="chat-stream__status-dots" aria-hidden="true">
            <span />
            <span />
            <span />
          </span>
        </div>
      )}
    </div>
  )
}
