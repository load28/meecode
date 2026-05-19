import { useEffect, useRef } from 'react'

/**
 * Sticky-to-bottom scroll behavior — matches the use-stick-to-bottom /
 * VS Code Claude pane pattern.
 *
 * - When the user is pinned to the bottom (within `threshold`px), any
 *   content growth re-snaps `scrollTop` to the bottom.
 * - As soon as the user scrolls up past the threshold, stickiness flips
 *   off and their position is preserved across all subsequent changes
 *   until they scroll back down to the bottom.
 *
 * Growth detection uses `ResizeObserver` on each direct child of the
 * scroll container, plus a `MutationObserver` to attach the RO to newly
 * appended children. This catches both reducer-driven segment adds and
 * in-place text growth from the smoothed-typewriter (when wrapping
 * causes height to change) without polling every frame.
 *
 * `deps` still triggers an immediate re-pin (e.g. session swap, expanded
 * pair change) so switching contexts lands at the bottom even before the
 * observers fire.
 */
export function useStickyScroll<T extends HTMLElement>(
  deps: ReadonlyArray<unknown>,
  threshold = 50,
) {
  const ref = useRef<T | null>(null)
  const stickyRef = useRef(true)

  // Deps-triggered re-pin (cheap shortcut for explicit content swaps).
  useEffect(() => {
    const el = ref.current
    if (!el) return
    if (!stickyRef.current) return
    el.scrollTop = el.scrollHeight
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps)

  useEffect(() => {
    const el = ref.current
    if (!el) return

    const snap = () => {
      if (stickyRef.current) {
        el.scrollTop = el.scrollHeight
      }
    }

    const ro = new ResizeObserver(snap)
    for (const child of Array.from(el.children)) {
      ro.observe(child)
    }

    const mo = new MutationObserver((records) => {
      for (const rec of records) {
        rec.addedNodes.forEach((n) => {
          if (n instanceof Element) ro.observe(n)
        })
      }
      // A newly mounted child contributes height before its first RO
      // callback fires; snap synchronously so the new segment never
      // briefly appears below the fold.
      snap()
    })
    mo.observe(el, { childList: true })

    return () => {
      ro.disconnect()
      mo.disconnect()
    }
  }, [])

  const onScroll = () => {
    const el = ref.current
    if (!el) return
    const atBottom =
      Math.abs(el.scrollHeight - el.scrollTop - el.clientHeight) <= threshold
    stickyRef.current = atBottom
  }

  return { ref, onScroll }
}
