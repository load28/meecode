import { useCallback, useEffect, useRef } from 'react'
import { listen } from '../platform/ipc'
import type { CodeSnippet } from '../types/composer'
import { useTabState } from '../state/tabViewStore'

export interface PendingComposerSelection {
  id: number
  text: string
  /** Optional `path:lineStart-lineEnd` shown as a `// ...` comment header. */
  source?: string
}

function snippetToSelection(snippet: CodeSnippet): PendingComposerSelection {
  const range =
    snippet.startLine === snippet.endLine
      ? `:${snippet.startLine}`
      : `:${snippet.startLine}-${snippet.endLine}`
  return {
    id: Date.now(),
    text: snippet.text,
    source: `${snippet.path}${range}`,
  }
}

export interface UsePendingSelectionResult {
  pending: PendingComposerSelection | null
  consume: () => void
  /** Source-with-range path (QaCard / file panel / detached window). */
  addSnippet: (snippet: CodeSnippet) => void
  /** Pure text, no source header (QaCard's comment buttons). */
  addComment: (text: string) => void
}

/**
 * State + intake API for the composer's "pending selection" — a snippet
 * captured from elsewhere in the app that will become an inline
 * `[코멘트 #N]` placeholder when the composer picks it up.
 *
 * Also subscribes to the `composer:add-context` Tauri event so a
 * detached file panel can hand off a snippet through the same channel
 * as an inline click. The listener stays alive for the hook's lifetime.
 */
export function usePendingSelection(
  tabId: string,
): UsePendingSelectionResult {
  const [pending, setPending] = useTabState<PendingComposerSelection | null>(
    tabId,
    'pendingSelection',
    null,
  )

  const addSnippet = useCallback(
    (snippet: CodeSnippet) => {
      setPending(snippetToSelection(snippet))
    },
    [setPending],
  )

  const addComment = useCallback(
    (text: string) => {
      setPending({ id: Date.now(), text })
    },
    [setPending],
  )

  const consume = useCallback(() => {
    setPending(null)
  }, [setPending])

  // The detached window can't reach our composer state directly, so it
  // forwards selection snippets through this event. Treat them exactly
  // like an inline add-context click.
  const addSnippetRef = useRef(addSnippet)
  addSnippetRef.current = addSnippet
  useEffect(() => {
    let unlisten: (() => void) | null = null
    let mounted = true
    void listen<CodeSnippet>('composer:add-context', (e) => {
      addSnippetRef.current(e.payload)
    }).then((u) => {
      if (!mounted) {
        u()
        return
      }
      unlisten = u
    })
    return () => {
      mounted = false
      unlisten?.()
    }
  }, [])

  return { pending, consume, addSnippet, addComment }
}
