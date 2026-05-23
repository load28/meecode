import { useEffect } from 'react'

/**
 * `active`일 때, container 바깥에서 mousedown이 발생하면 `onOutside`를
 * 호출한다. 드롭다운 패널/모달을 닫는 일반적 패턴.
 *
 * - container ref가 비어있거나 `active`가 false면 listener를 달지 않는다.
 * - mousedown을 사용하는 이유: click 단계에서 닫으면 동일한 클릭이 트리거한
 *   다른 핸들러가 다시 패널을 열어버리는 토글 충돌을 피하기 위해서다.
 */
export function useClickOutside<T extends HTMLElement>(
  ref: React.RefObject<T | null>,
  active: boolean,
  onOutside: () => void,
): void {
  useEffect(() => {
    if (!active) return
    const handler = (e: MouseEvent) => {
      const el = ref.current
      if (el && !el.contains(e.target as Node)) onOutside()
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [ref, active, onOutside])
}
