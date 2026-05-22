import { useEffect } from 'react'
import type { ApprovalKey, ApprovalOption } from './options'

interface Options {
  containerRef: React.MutableRefObject<HTMLElement | null>
  options: ApprovalOption[]
  /** 키 이벤트에 따라 선택될 옵션 key를 알려준다. */
  onSelect: (key: ApprovalKey) => void
}

/**
 * 카드 내부에서 keydown을 들어 숫자/Enter/Esc로 옵션을 빠르게 결정한다.
 *
 *   - 1~9 키: 해당 인덱스의 옵션 (있을 때만)
 *   - Enter: 첫 번째 옵션 (보통 '예 (한 번 허용)')
 *   - Escape: 'deny'
 *
 * 입력 필드(input/textarea) 위에서는 가로채지 않는다 — DenyMessageForm
 * 내부 입력값에서도 Enter/Esc를 자유롭게 쓸 수 있게 하기 위해서다.
 *
 * 매 렌더마다 handler를 다시 다는 것은 의도적이다 — onSelect 클로저가
 * 최신 onRespond를 잡고 있어야 카드가 자기 자신을 update한 직후에도
 * 정확한 응답을 보낸다.
 */
export function useApprovalKeyboard({
  containerRef,
  options,
  onSelect,
}: Options): void {
  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const handler = (e: KeyboardEvent) => {
      if (
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement
      ) {
        return
      }
      if (e.key >= '1' && e.key <= '9') {
        const idx = Number(e.key) - 1
        if (idx >= 0 && idx < options.length) {
          e.preventDefault()
          onSelect(options[idx].key)
        }
        return
      }
      if (e.key === 'Enter') {
        e.preventDefault()
        if (options[0]) onSelect(options[0].key)
        return
      }
      if (e.key === 'Escape') {
        e.preventDefault()
        onSelect('deny')
      }
    }
    el.addEventListener('keydown', handler)
    return () => el.removeEventListener('keydown', handler)
  })
}
