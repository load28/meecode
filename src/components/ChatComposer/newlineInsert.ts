/**
 * textarea의 caret 위치에 줄바꿈을 삽입한다. requestAnimationFrame으로
 * setValue가 반영된 다음에 캐럿 위치를 다시 잡는다.
 *
 * `consumeBackslash`가 true면 caret 직전 한 글자(보통 `\`)를 같이 지운다 —
 * 사용자가 `\` 한 번에 줄바꿈을 의도한 경우 그 백슬래시는 흔적 없이 사라져야
 * 하기 때문.
 */
export function insertNewlineAtCaret(
  textarea: HTMLTextAreaElement | null,
  value: string,
  setValue: (next: string) => void,
  opts: { consumeBackslash?: boolean } = {},
) {
  const caret = textarea?.selectionStart ?? value.length
  const drop = opts.consumeBackslash ? 1 : 0
  const next = value.slice(0, caret - drop) + '\n' + value.slice(caret)
  setValue(next)
  // `\`를 먹은 경우 caret은 그 자리에 그대로 두는 것이 자연스럽고,
  // 평범한 줄바꿈은 한 칸 뒤로 옮긴다.
  const nextCaret = opts.consumeBackslash ? caret : caret + 1
  requestAnimationFrame(() => {
    if (!textarea) return
    textarea.focus()
    textarea.setSelectionRange(nextCaret, nextCaret)
  })
}

/**
 * Enter 키가 눌렸을 때 줄바꿈 삽입을 시도한다. 두 케이스가 있다:
 *
 *   1. backslash + Enter: caret 직전이 `\`이면 그 백슬래시를 소비하고 줄바꿈.
 *      Shift/Alt/Meta 없이 평범한 Enter일 때만.
 *   2. Alt/Meta + Enter: 무조건 줄바꿈 삽입.
 *
 * 둘 다 처리한 경우 `true`를 반환 — 호출자는 즉시 return해야 한다(이중
 * submit을 막기 위해).
 */
export function tryNewlineInsert(
  e: React.KeyboardEvent<HTMLTextAreaElement>,
  textarea: HTMLTextAreaElement | null,
  value: string,
  setValue: (next: string) => void,
): boolean {
  if (e.key !== 'Enter') return false

  // backslash + Enter
  if (!e.shiftKey && !e.altKey && !e.metaKey) {
    const caret = textarea?.selectionStart ?? value.length
    if (caret > 0 && value[caret - 1] === '\\') {
      e.preventDefault()
      insertNewlineAtCaret(textarea, value, setValue, { consumeBackslash: true })
      return true
    }
    return false
  }

  // Alt/Meta + Enter
  if (e.altKey || e.metaKey) {
    e.preventDefault()
    insertNewlineAtCaret(textarea, value, setValue)
    return true
  }

  return false
}
