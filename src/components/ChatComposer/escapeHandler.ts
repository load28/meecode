import type { UseEscapeDoublePressResult } from '../../hooks/useEscapeDoublePress'

interface Deps {
  /** 멘션 메뉴가 열려있으면 그걸 닫는 게 우선. */
  mentionActive: boolean
  closeMention: () => void
  /** busy일 때는 진행 중 작업을 인터럽트. onInterrupt가 없으면 건너뜀. */
  busy: boolean
  onInterrupt: (() => void) | undefined
  escClear: UseEscapeDoublePressResult
  /** 더블 ESC가 확정되면 호출 — composer 내부 정리(value 비우기 등). */
  onConfirmedClear: () => void
  /** 더블 ESC clear가 의미 있는 상황(=value가 비어있지 않은가). */
  hasInput: boolean
}

/**
 * composer onKeyDown 내 ESC 분기를 한 함수로 캡슐화. 우선순위:
 *   1) 멘션 메뉴가 열려 있으면 닫기
 *   2) busy + onInterrupt가 있으면 인터럽트
 *   3) value가 있으면 더블 프레스 clear 사이클
 * 처리한 경우 `true`를 반환 — 호출자는 즉시 return.
 */
export function handleEscape(
  e: React.KeyboardEvent,
  deps: Deps,
): boolean {
  if (e.key !== 'Escape') return false
  const {
    mentionActive,
    closeMention,
    busy,
    onInterrupt,
    escClear,
    onConfirmedClear,
    hasInput,
  } = deps

  if (mentionActive) {
    e.preventDefault()
    closeMention()
    escClear.reset()
    return true
  }
  // CLI parity (PromptInput.tsx): busy 중 ESC는 항상 인터럽트가 먼저.
  // 더블 프레스 clear는 idle일 때만.
  if (busy && onInterrupt) {
    e.preventDefault()
    onInterrupt()
    escClear.reset()
    return true
  }
  // 더블 ESC clear (CLI useTextInput handleEscape via useDoublePress):
  // 첫 ESC는 arm + hint, 같은 윈도 안의 두 번째 ESC가 실제 clear.
  if (hasInput) {
    e.preventDefault()
    if (escClear.press()) {
      onConfirmedClear()
    }
    return true
  }
  return false
}
