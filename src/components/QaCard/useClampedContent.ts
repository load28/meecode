import { useEffect, useRef, useState } from 'react'

export interface UseClampedContentResult<
  O extends HTMLElement,
  I extends HTMLElement,
> {
  /** maxHeight로 잘리는 바깥 래퍼. */
  outerRef: React.MutableRefObject<O | null>
  /** 잘리지 않는 안쪽 콘텐츠 — 실제 높이 측정 대상. */
  contentRef: React.MutableRefObject<I | null>
  expanded: boolean
  toggle: () => void
  /**
   * 콘텐츠 높이가 clamp 임계를 초과해 "더 보기" 토글이 의미가 있는 상태인지.
   * 짧은 카드에서는 토글 자체를 숨기는 용도.
   */
  overflowing: boolean
  /** clamped/expanded 상태를 반영한 바깥 래퍼 className. */
  className: string
}

/**
 * 카드 본문 전체(질문 + 답변)를 max-height로 잘라두고 사용자가 "더 보기"로
 * 펼치도록 하는 훅.
 *
 * 바깥(outer) 요소는 maxHeight로 잘려 그 자체로는 넘침을 잴 수 없으므로,
 * 잘리지 않는 안쪽(content) 요소를 ResizeObserver로 관찰해 실제 콘텐츠
 * 높이를 임계와 비교한다 — 스트리밍이나 Task 컨텍스트 펼침처럼 어떤 높이
 * 변동에도 overflowing이 정확히 갱신된다.
 */
export function useClampedContent<
  O extends HTMLElement,
  I extends HTMLElement,
>(maxHeightPx: number): UseClampedContentResult<O, I> {
  const [expanded, setExpanded] = useState(false)
  const [overflowing, setOverflowing] = useState(false)
  const outerRef = useRef<O | null>(null)
  const contentRef = useRef<I | null>(null)

  useEffect(() => {
    const el = contentRef.current
    if (!el) {
      setOverflowing(false)
      return
    }
    // +1은 sub-pixel rounding을 흡수해 정확히 maxHeight일 때 토글이
    // 깜빡이지 않게 한다.
    const check = () => setOverflowing(el.scrollHeight > maxHeightPx + 1)
    check()
    const ro = new ResizeObserver(check)
    ro.observe(el)
    return () => ro.disconnect()
  }, [maxHeightPx])

  const className = expanded
    ? 'qa-card__body qa-card__body--expanded'
    : overflowing
    ? 'qa-card__body qa-card__body--clamped'
    : 'qa-card__body'

  const toggle = () => setExpanded((v) => !v)

  return { outerRef, contentRef, expanded, toggle, overflowing, className }
}
