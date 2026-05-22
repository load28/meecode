import { useCallback, useEffect, useRef, useState } from 'react'
import { offsetWithin } from './utils'

export interface CodeSelection {
  text: string
  startLine: number
  endLine: number
  rect: { top: number; left: number }
}

const ACTION_OFFSET_PX = 6

export interface UseCodeSelectionResult {
  selection: CodeSelection | null
  codeRef: React.MutableRefObject<HTMLDivElement | null>
  handleMouseUp: () => void
  clear: () => void
}

/**
 * Track the user's text selection inside the highlighted code container,
 * computing the absolute line range and an offset for the floating
 * action affordance. Selection clears when:
 *   - the user mouse-ups with no range (or whitespace-only text), or
 *   - the user navigates to a different tab (signaled by `resetKey`).
 *
 * The hook returns a ref the caller attaches to the code container so
 * the selection can be constrained to that subtree (and so its origin
 * can be subtracted from getBoundingClientRect() coordinates).
 */
export function useCodeSelection(resetKey: string | null): UseCodeSelectionResult {
  const codeRef = useRef<HTMLDivElement | null>(null)
  const [selection, setSelection] = useState<CodeSelection | null>(null)

  useEffect(() => {
    setSelection(null)
  }, [resetKey])

  const clear = useCallback(() => setSelection(null), [])

  const handleMouseUp = useCallback(() => {
    const sel = window.getSelection()
    if (!sel || sel.isCollapsed) {
      setSelection(null)
      return
    }
    const text = sel.toString()
    if (!text.trim()) {
      setSelection(null)
      return
    }
    const range = sel.getRangeAt(0)
    const code = codeRef.current
    if (!code) return
    if (!code.contains(range.commonAncestorContainer)) {
      setSelection(null)
      return
    }
    const before = code.textContent?.slice(
      0,
      code.textContent
        ? offsetWithin(code, range.startContainer, range.startOffset)
        : 0,
    ) ?? ''
    const startLine = before.split('\n').length
    const endLine = startLine + text.split('\n').length - 1
    const rect = range.getBoundingClientRect()
    const codeRect = code.getBoundingClientRect()
    setSelection({
      text,
      startLine,
      endLine,
      rect: {
        top:
          rect.top - codeRect.top + code.scrollTop + rect.height + ACTION_OFFSET_PX,
        left: rect.left - codeRect.left + code.scrollLeft,
      },
    })
  }, [])

  return { selection, codeRef, handleMouseUp, clear }
}
