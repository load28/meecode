import { useEffect, useRef } from 'react'
import { QaCard } from '../QaCard'
import type { QaPair } from '../../types'
import './ChatStream.css'

interface Props {
  pairs: QaPair[]
  onExpand: (id: string) => void
}

export function ChatStream({ pairs, onExpand }: Props) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const shouldAutoScrollRef = useRef(true)
  const userScrolledRef = useRef(false)

  useEffect(() => {
    if (!shouldAutoScrollRef.current || !scrollRef.current) return
    const el = scrollRef.current
    el.scrollTop = el.scrollHeight
  }, [pairs])

  const handleScroll = () => {
    const el = scrollRef.current
    if (!el) return
    const atBottom = Math.abs(el.scrollHeight - el.scrollTop - el.clientHeight) < 50
    if (!atBottom) {
      userScrolledRef.current = true
      shouldAutoScrollRef.current = false
    } else if (userScrolledRef.current) {
      shouldAutoScrollRef.current = true
      userScrolledRef.current = false
    }
  }

  if (pairs.length === 0) {
    return (
      <div className="chat-stream chat-stream--empty">
        <p>프로젝트가 시작되었습니다. 아래에서 첫 질문을 입력하세요.</p>
      </div>
    )
  }

  const last = pairs[pairs.length - 1]
  const lastSeg = last.segments[last.segments.length - 1]
  const indicator =
    last.segments.length === 0
      ? 'Claude가 응답 대기 중…'
      : lastSeg && lastSeg.kind === 'tool_use'
      ? 'Claude가 도구를 실행 중…'
      : null

  return (
    <div ref={scrollRef} className="chat-stream" onScroll={handleScroll}>
      {pairs.map((p) => (
        <QaCard
          key={p.id}
          pair={p}
          onExpand={() => onExpand(p.id)}
        />
      ))}
      {indicator && <div className="chat-stream__status">{indicator}</div>}
    </div>
  )
}
