import { useEffect, useRef } from 'react'

/**
 * Sticky-to-bottom scroll behavior.
 *
 * - If the user is at the bottom (within `threshold`px) when a content
 *   change arrives, the container is re-pinned to the bottom.
 * - If the user has scrolled up, their position is preserved across
 *   content changes (no surprise jumps while reading older messages).
 *
 * Pass `deps` that change whenever new content arrives.
 */
export function useStickyScroll<T extends HTMLElement>(
  deps: ReadonlyArray<unknown>,
  threshold = 50,
) {
  const ref = useRef<T | null>(null)
  const stickyRef = useRef(true)

  // After every content change, scroll to the bottom only if we were
  // already pinned to the bottom before the change.
  useEffect(() => {
    const el = ref.current
    if (!el) return
    if (!stickyRef.current) return
    el.scrollTop = el.scrollHeight
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps)

  const onScroll = () => {
    const el = ref.current
    if (!el) return
    const atBottom =
      Math.abs(el.scrollHeight - el.scrollTop - el.clientHeight) <= threshold
    stickyRef.current = atBottom
  }

  return { ref, onScroll }
}
