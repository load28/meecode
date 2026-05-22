import type { UseSlashMenuResult } from '../../hooks/useSlashMenu'
import type { UseMentionMenuResult } from '../../hooks/useMentionMenu'
import type { UseTextHistoryResult } from '../../hooks/useTextHistory'
import type { UseEscapeDoublePressResult } from '../../hooks/useEscapeDoublePress'
import type { UseImeComposingGuardResult } from '../../hooks/useImeComposingGuard'
import { tryNewlineInsert } from './newlineInsert'
import { handleEscape } from './escapeHandler'

interface Options {
  value: string
  setValue: (next: string) => void
  textareaRef: React.MutableRefObject<HTMLTextAreaElement | null>
  ime: UseImeComposingGuardResult
  slashMenu: UseSlashMenuResult
  mentionMenu: UseMentionMenuResult
  history: UseTextHistoryResult
  escClear: UseEscapeDoublePressResult
  busy: boolean
  cycleMode: () => void
  onInterrupt: (() => void) | undefined
  onClearConversation: (() => void) | undefined
  onConfirmedEscClear: () => void
  submit: () => void
}

/**
 * composer textarea의 키 이벤트 라우터.
 *
 * 우선순위는 원본과 동일:
 *   1) IME 조합 중에는 Enter류 차단(ESC만 통과)
 *   2) 멘션 메뉴 활성 → 그쪽 키 처리
 *   3) 슬래시 메뉴 활성 → 그쪽 키 처리
 *   4) Shift+Tab → 모드 토글
 *   5) Ctrl/Cmd+L → 대화 비우기
 *   6) Arrow Up/Down → 메시지 히스토리 페이지
 *   7) ESC → mention 닫기 / busy interrupt / double-press clear
 *   8) Enter류 → newline 삽입 또는 submit
 */
export function useComposerKeyboard({
  value,
  setValue,
  textareaRef,
  ime,
  slashMenu,
  mentionMenu,
  history,
  escClear,
  busy,
  cycleMode,
  onInterrupt,
  onClearConversation,
  onConfirmedEscClear,
  submit,
}: Options) {
  return (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    const composing = ime.isComposingEvent(e)
    if (composing && e.key !== 'Escape') return
    if (mentionMenu.handleKeyDown(e)) return
    if (slashMenu.handleKeyDown(e)) return
    if (e.key === 'Tab' && e.shiftKey) {
      e.preventDefault()
      cycleMode()
      return
    }
    if (
      (e.ctrlKey || e.metaKey) &&
      (e.key === 'l' || e.key === 'L') &&
      onClearConversation
    ) {
      e.preventDefault()
      onClearConversation()
      return
    }
    if (history.tryNavigate(e, textareaRef.current, value, setValue)) return
    if (
      handleEscape(e, {
        mentionActive: !!mentionMenu.state,
        closeMention: mentionMenu.close,
        busy,
        onInterrupt,
        escClear,
        hasInput: value.length > 0,
        onConfirmedClear: onConfirmedEscClear,
      })
    ) {
      return
    }
    if (composing) return
    if (tryNewlineInsert(e, textareaRef.current, value, setValue)) return
    if (e.key === 'Enter' && !e.shiftKey && !e.metaKey && !e.altKey) {
      e.preventDefault()
      submit()
    }
  }
}
