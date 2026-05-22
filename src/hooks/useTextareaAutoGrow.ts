import { useEffect } from 'react'

const DEFAULT_MAX_HEIGHT_PX = 280

/**
 * textarea의 높이를 내용에 맞춰 scrollHeight까지 늘리되 `maxHeightPx`를
 * 넘으면 그 값에서 클램프하는 효과.
 *
 * `value`가 바뀔 때마다 measure → set 사이클을 돌린다. 일단 'auto'로
 * 리셋해 자연 scrollHeight를 다시 측정하는 것이 핵심 — 안 그러면 글자가
 * 줄어들 때 textarea가 따라 줄지 않는다.
 */
export function useTextareaAutoGrow(
  ref: React.MutableRefObject<HTMLTextAreaElement | null>,
  value: string,
  maxHeightPx: number = DEFAULT_MAX_HEIGHT_PX,
): void {
  useEffect(() => {
    const ta = ref.current
    if (!ta) return
    ta.style.height = 'auto'
    const next = Math.min(ta.scrollHeight, maxHeightPx)
    ta.style.height = next + 'px'
  }, [ref, value, maxHeightPx])
}
