import { useEffect } from 'react'

interface Options {
  /** active이고 onInterrupt가 있을 때만 리스너를 단다. */
  active: boolean
  onInterrupt: (() => void) | undefined
  /** IME 조합 중이면 ESC를 무시하기 위한 ref. */
  isComposingRef: React.MutableRefObject<boolean>
  /**
   * 이 element에 포커스가 있을 때는 ESC를 처리하지 않는다 — 보통
   * composer textarea로, 거기엔 별도의 onKeyDown 흐름이 있다.
   */
  excludeTargetRef: React.MutableRefObject<HTMLElement | null>
}

/**
 * busy 중일 때 textarea 바깥(승인 카드/파일 패널 등)에서 ESC가 눌리면
 * onInterrupt를 호출한다.
 *
 * - busy 또는 onInterrupt가 없으면 리스너 자체를 달지 않는다.
 * - IME 조합 중인 ESC는 무시 — 한글 입력 취소를 우선.
 * - textarea가 이벤트 타겟이면 처리하지 않는다 — 그 경로는 부모 컴포넌트의
 *   로컬 onKeyDown이 처리(슬래시/멘션 팔레트 닫기 등을 먼저 본다).
 */
export function useGlobalEscapeInterrupt({
  active,
  onInterrupt,
  isComposingRef,
  excludeTargetRef,
}: Options): void {
  useEffect(() => {
    if (!active || !onInterrupt) return
    const handler = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      if (isComposingRef.current) return
      if (e.target === excludeTargetRef.current) return
      e.preventDefault()
      onInterrupt()
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [active, onInterrupt, isComposingRef, excludeTargetRef])
}
