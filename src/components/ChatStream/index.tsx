import { useEffect, useRef } from 'react'
import { useVirtualizer, observeElementRect } from '@tanstack/react-virtual'
import type { Virtualizer } from '@tanstack/react-virtual'
import { AnimatePresence, motion } from 'framer-motion'
import { QaCard } from '../QaCard'
import type { QaPair } from '../../types'
import './ChatStream.css'

// jsdom에서는 offsetHeight가 0이어서 virtualizer가 아이템을 렌더링하지 않는다.
// 실제 측정값이 0이면 대형 기본값으로 대체해 테스트 환경에서도 아이템을 렌더링한다.
function observeElementRectWithFallback(
  instance: Virtualizer<HTMLDivElement, HTMLElement>,
  cb: (rect: { width: number; height: number }) => void,
) {
  return observeElementRect(instance as never, (rect) => {
    cb({
      width: rect.width || 1200,
      height: rect.height || 800,
    })
  })
}

interface Props {
  pairs: QaPair[]
  expandedId: string | null
  onExpand: (id: string) => void
}

export function ChatStream({ pairs, expandedId, onExpand }: Props) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const shouldAutoScrollRef = useRef(true)
  const userScrolledRef = useRef(false)

  const virtualizer = useVirtualizer({
    count: pairs.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 140,
    measureElement: (el) => el.getBoundingClientRect().height,
    overscan: 6,
    observeElementRect: observeElementRectWithFallback,
  })

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

  const items = virtualizer.getVirtualItems()

  return (
    <div ref={scrollRef} className="chat-stream" onScroll={handleScroll}>
      <div
        style={{
          height: `${virtualizer.getTotalSize()}px`,
          width: '100%',
          position: 'relative',
        }}
      >
        <AnimatePresence mode="popLayout">
          {items.map((vi) => {
            const p = pairs[vi.index]
            return (
              <motion.div
                key={p.id}
                ref={virtualizer.measureElement}
                data-index={vi.index}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.18 }}
                style={{
                  position: 'absolute',
                  top: 0,
                  left: 0,
                  width: '100%',
                  transform: `translateY(${vi.start}px)`,
                }}
              >
                <QaCard
                  pair={p}
                  isExpandedInPane={p.id === expandedId}
                  onExpand={() => onExpand(p.id)}
                />
              </motion.div>
            )
          })}
        </AnimatePresence>
      </div>
    </div>
  )
}
