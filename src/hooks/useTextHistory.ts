import { useCallback, useState } from 'react'

function cursorAtFirstLine(
  ta: HTMLTextAreaElement | null,
  value: string,
): boolean {
  if (!ta) return true
  const caret = ta.selectionStart ?? 0
  return (
    value.indexOf('\n') === -1 || value.lastIndexOf('\n', caret - 1) === -1
  )
}

function cursorAtLastLine(
  ta: HTMLTextAreaElement | null,
  value: string,
): boolean {
  if (!ta) return true
  const caret = ta.selectionEnd ?? value.length
  return value.indexOf('\n', caret) === -1
}

export interface UseTextHistoryResult {
  /**
   * Try handling an ArrowUp/ArrowDown press as history navigation.
   * Returns `true` when the key consumed the event and the caller
   * should `preventDefault` + return early. Returns `false` to fall
   * through to the textarea's native caret movement.
   */
  tryNavigate: (
    e: React.KeyboardEvent<HTMLTextAreaElement>,
    textarea: HTMLTextAreaElement | null,
    value: string,
    setValue: (next: string) => void,
  ) => boolean
  /** Reset the cursor; call on submit, clear, or any explicit user typing. */
  reset: () => void
}

/**
 * CLI-parity textarea history navigation. ArrowUp at the first line
 * pages backwards through `history`; ArrowDown at the last line pages
 * forward and falls off the end into an empty draft. Multi-line drafts
 * keep working because the navigation only triggers when the cursor
 * genuinely can't move further in-text.
 */
export function useTextHistory(
  history: string[] | undefined,
): UseTextHistoryResult {
  const [idx, setIdx] = useState<number | null>(null)

  const reset = useCallback(() => {
    setIdx(null)
  }, [])

  const tryNavigate = useCallback(
    (
      e: React.KeyboardEvent<HTMLTextAreaElement>,
      ta: HTMLTextAreaElement | null,
      value: string,
      setValue: (next: string) => void,
    ): boolean => {
      const list = history ?? []
      if (list.length === 0) return false

      // Enter history from the empty caret — first ArrowUp on the first line.
      if (
        e.key === 'ArrowUp' &&
        !e.shiftKey &&
        idx === null &&
        cursorAtFirstLine(ta, value)
      ) {
        e.preventDefault()
        const lastIdx = list.length - 1
        setIdx(lastIdx)
        setValue(list[lastIdx])
        return true
      }
      // Page further back.
      if (
        e.key === 'ArrowUp' &&
        idx !== null &&
        idx > 0 &&
        cursorAtFirstLine(ta, value)
      ) {
        e.preventDefault()
        const next = idx - 1
        setIdx(next)
        setValue(list[next])
        return true
      }
      // Page forward, falling off the end into a fresh empty draft.
      if (e.key === 'ArrowDown' && idx !== null && cursorAtLastLine(ta, value)) {
        e.preventDefault()
        if (idx < list.length - 1) {
          const next = idx + 1
          setIdx(next)
          setValue(list[next])
        } else {
          setIdx(null)
          setValue('')
        }
        return true
      }
      return false
    },
    [history, idx],
  )

  return { tryNavigate, reset }
}
