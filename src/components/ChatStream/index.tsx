import { useEffect, useRef } from 'react'
import { QaCard } from '../QaCard'
import { ToolApprovalCard } from '../ToolApprovalCard'
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
}

export function ChatStream({
  pairs,
  onExpand,
  pendingTool,
  onRespondTool,
}: Props) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const shouldAutoScrollRef = useRef(true)
  const userScrolledRef = useRef(false)

  useEffect(() => {
    if (!shouldAutoScrollRef.current || !scrollRef.current) return
    const el = scrollRef.current
    el.scrollTop = el.scrollHeight
  }, [pairs, pendingTool])

  const handleScroll = () => {
    const el = scrollRef.current
    if (!el) return
    const atBottom =
      Math.abs(el.scrollHeight - el.scrollTop - el.clientHeight) < 50
    if (!atBottom) {
      userScrolledRef.current = true
      shouldAutoScrollRef.current = false
    } else if (userScrolledRef.current) {
      shouldAutoScrollRef.current = true
      userScrolledRef.current = false
    }
  }

  if (pairs.length === 0 && !pendingTool) {
    return (
      <div className="chat-stream chat-stream--empty">
        <p>프로젝트가 시작되었습니다. 아래에서 첫 질문을 입력하세요.</p>
      </div>
    )
  }

  const last = pairs[pairs.length - 1]
  const lastSeg = last?.segments[last.segments.length - 1]
  const indicator =
    !pendingTool && last
      ? last.segments.length === 0
        ? 'Claude가 응답 대기 중…'
        : lastSeg && lastSeg.kind === 'tool_use'
        ? 'Claude가 도구를 실행 중…'
        : null
      : null

  return (
    <div ref={scrollRef} className="chat-stream" onScroll={handleScroll}>
      {pairs.map((p) => (
        <QaCard key={p.id} pair={p} onExpand={() => onExpand(p.id)} />
      ))}
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
      {indicator && <div className="chat-stream__status">{indicator}</div>}
    </div>
  )
}
