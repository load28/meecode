import { useEffect, useRef } from 'react'

/**
 * 콜백이 매 렌더마다 새 참조라도, value가 바뀔 때마다 "가장 최근 콜백"이
 * 호출되도록 보장하는 작은 헬퍼.
 *
 * 예: 세션 타이틀이 바뀔 때마다 부모에게 알려야 하는데, 부모가 매 렌더
 * 새 콜백을 만들 수도 있다 — ref로 최신 콜백을 잡아두고 value가 바뀌면
 * 그 시점의 ref를 호출한다.
 */
export function useSyncEffect<T>(callback: (value: T) => void, value: T): void {
  const ref = useRef(callback)
  ref.current = callback
  useEffect(() => {
    ref.current(value)
  }, [value])
}
