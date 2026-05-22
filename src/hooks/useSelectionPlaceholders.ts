import { useCallback, useEffect, useRef } from 'react'

export interface PendingSelection {
  id: number
  text: string
  /** Optional `path:lineStart-lineEnd` shown as a `// ...` comment header. */
  source?: string
}

interface Selection {
  text: string
  source?: string
}

const PLACEHOLDER_PATTERN = /\[코멘트 #(\d+) \+\d+줄\]/g

function placeholderToken(num: number, lines: number): string {
  return `[코멘트 #${num} +${lines}줄]`
}

function expandToFencedBlock(sel: Selection): string {
  const header = sel.source ? `// ${sel.source}\n` : ''
  return `\n\n\`\`\`\n${header}${sel.text}\n\`\`\`\n`
}

interface UseSelectionPlaceholdersOptions {
  pendingSelection: PendingSelection | null | undefined
  onSelectionConsumed: (() => void) | undefined
  textareaRef: React.RefObject<HTMLTextAreaElement | null>
  value: string
  setValue: (
    next: string | ((prev: string) => string),
  ) => void
}

export interface UseSelectionPlaceholdersResult {
  /**
   * Replace every `[코멘트 #N +M줄]` placeholder in the given text with
   * the fenced code block stored under that id. Unknown ids silently
   * drop — matches the CLI's behavior with stale paste tokens.
   */
  expand: (text: string) => string
  /** Drop every registered selection. Call on submit / clear. */
  clear: () => void
}

/**
 * Track inline selection placeholders inserted into the composer.
 *
 * Selections arrive through `pendingSelection`; each unique id is
 * registered once, a `[코멘트 #N +M줄]` token is spliced at the caret,
 * and on submit `expand()` substitutes each token back to its full
 * fenced code block. The hook owns the registry, the auto-increment
 * counter, and the de-dup ref so the same selection isn't inserted
 * twice on re-renders.
 */
export function useSelectionPlaceholders({
  pendingSelection,
  onSelectionConsumed,
  textareaRef,
  value,
  setValue,
}: UseSelectionPlaceholdersOptions): UseSelectionPlaceholdersResult {
  const registry = useRef<Map<number, Selection>>(new Map())
  const counter = useRef(0)
  const lastPendingId = useRef<number | null>(null)

  useEffect(() => {
    if (!pendingSelection) return
    if (lastPendingId.current === pendingSelection.id) return
    lastPendingId.current = pendingSelection.id

    const num = ++counter.current
    registry.current.set(num, {
      text: pendingSelection.text,
      source: pendingSelection.source,
    })
    const lines = pendingSelection.text.split('\n').length
    const placeholder = placeholderToken(num, lines)

    const ta = textareaRef.current
    const caret =
      ta?.selectionStart != null && document.activeElement === ta
        ? ta.selectionStart
        : value.length
    let nextCaret = caret
    setValue((v) => {
      const before = v.slice(0, caret)
      const after = v.slice(caret)
      const sepBefore =
        before.length > 0 && !before.endsWith(' ') && !before.endsWith('\n')
          ? ' '
          : ''
      const sepAfter =
        after.length > 0 && !after.startsWith(' ') && !after.startsWith('\n')
          ? ' '
          : ''
      const next = before + sepBefore + placeholder + sepAfter + after
      nextCaret = (before + sepBefore + placeholder + sepAfter).length
      return next
    })
    requestAnimationFrame(() => {
      const t = textareaRef.current
      if (t) {
        t.focus()
        try {
          t.setSelectionRange(nextCaret, nextCaret)
        } catch {
          /* setSelectionRange can throw if the value isn't applied yet — harmless */
        }
      }
    })
    onSelectionConsumed?.()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingSelection, onSelectionConsumed])

  const expand = useCallback((text: string): string => {
    return text.replace(PLACEHOLDER_PATTERN, (_, n) => {
      const sel = registry.current.get(Number(n))
      if (!sel) return ''
      return expandToFencedBlock(sel)
    })
  }, [])

  const clear = useCallback(() => {
    registry.current.clear()
    counter.current = 0
  }, [])

  return { expand, clear }
}
