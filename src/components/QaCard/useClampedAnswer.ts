import { useEffect, useRef, useState } from 'react'

export interface UseClampedAnswerResult<T extends HTMLElement> {
  ref: React.MutableRefObject<T | null>
  expanded: boolean
  toggle: () => void
  /**
   * 실제 콘텐츠 높이가 clamp 높이를 초과해서 "더 보기" 토글이 의미가
   * 있는 상태인지. 짧은 답변에서는 토글 자체를 숨기는 용도.
   */
  overflowing: boolean
  /** clamped/expanded 상태를 반영한 className. */
  className: string
}

/**
 * 답변 본문을 max-height로 잘라두고 사용자가 명시적으로 펼치도록 하는
 * 훅. ResizeObserver로 콘텐츠 높이 변동을 추적해 overflowing 플래그를
 * 갱신한다(스트리밍 중 답변이 점점 길어질 때도 정확).
 *
 * resetKey가 바뀌면 overflowing을 다시 측정한다 — 새 segments가 들어왔을 때.
 */
export function useClampedAnswer<T extends HTMLElement>(
  resetKey: unknown,
): UseClampedAnswerResult<T> {
  const [expanded, setExpanded] = useState(false)
  const [overflowing, setOverflowing] = useState(false)
  const ref = useRef<T | null>(null)

  useEffect(() => {
    const el = ref.current
    if (!el) {
      setOverflowing(false)
      return
    }
    const check = () => {
      // clamped 높이(clientHeight)와 실제 콘텐츠 높이(scrollHeight) 비교.
      // +1은 sub-pixel rounding을 흡수해 정확히 max-height일 때 토글이
      // 깜빡이지 않게 한다.
      setOverflowing(el.scrollHeight > el.clientHeight + 1)
    }
    check()
    const ro = new ResizeObserver(check)
    ro.observe(el)
    return () => ro.disconnect()
  }, [resetKey])

  const className = expanded
    ? 'qa-card__answer qa-card__answer--expanded'
    : overflowing
    ? 'qa-card__answer qa-card__answer--clamped'
    : 'qa-card__answer'

  const toggle = () => setExpanded((v) => !v)

  return { ref, expanded, toggle, overflowing, className }
}
