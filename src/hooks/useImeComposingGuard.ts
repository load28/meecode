import { useCallback, useRef } from 'react'

export interface UseImeComposingGuardResult {
  /** useGlobalEscapeInterrupt 같은 다른 훅에 전달하기 위한 ref. */
  isComposingRef: React.MutableRefObject<boolean>
  /** textarea/input의 onCompositionStart에 그대로 매핑. */
  onCompositionStart: () => void
  /** onCompositionEnd에 그대로 매핑. */
  onCompositionEnd: () => void
  /**
   * 키 이벤트가 IME 조합 중에 발생했는지 판단. keyCode 229와 native
   * isComposing까지 함께 확인해 브라우저별 차이를 흡수한다.
   */
  isComposingEvent: (e: React.KeyboardEvent) => boolean
}

/**
 * IME 조합(한·중·일 등) 중인지 추적하기 위한 작은 훅. composition
 * 이벤트로 ref를 갱신하고, 키 이벤트 시점에 어떤 조합인지 즉시
 * 판단할 수 있는 헬퍼를 제공한다.
 */
export function useImeComposingGuard(): UseImeComposingGuardResult {
  const isComposingRef = useRef(false)

  const onCompositionStart = useCallback(() => {
    isComposingRef.current = true
  }, [])
  const onCompositionEnd = useCallback(() => {
    isComposingRef.current = false
  }, [])

  const isComposingEvent = useCallback((e: React.KeyboardEvent): boolean => {
    return (
      isComposingRef.current ||
      e.keyCode === 229 ||
      (e.nativeEvent as KeyboardEvent).isComposing
    )
  }, [])

  return {
    isComposingRef,
    onCompositionStart,
    onCompositionEnd,
    isComposingEvent,
  }
}
