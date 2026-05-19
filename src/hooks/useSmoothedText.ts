import { useEffect, useRef, useState } from 'react'

interface Options {
  /** Floor cps (chars per second) when the backlog is tiny. */
  baseCps?: number
  /** Per-char-backlog multiplier — bigger backlog accelerates reveal so
   *  we never visibly fall behind the network feed. */
  backlogMultiplier?: number
  /** Hard ceiling so a giant burst doesn't snap-paste. */
  maxCps?: number
}

/**
 * Drives a smoothed character-by-character reveal of `target` while
 * `isStreaming` is true. Matches the typewriter feel the VS Code Claude
 * extension uses: tokens arrive in 10-char bursts over the network but the
 * UI displays them at the display's frame rate (~60fps) instead of jumping.
 *
 * - While streaming, an rAF loop advances `displayed` toward `target` at an
 *   adaptive rate (`max(baseCps, backlog * mult)`, capped at `maxCps`).
 * - When streaming stops or the target shrinks/diverges, snaps to target
 *   immediately so completed messages render in full instantly.
 * - On any prefix mismatch (e.g. a fresh segment swapped in), restarts from
 *   the empty string so we don't show stale half-content.
 */
export function useSmoothedText(
  target: string,
  isStreaming: boolean,
  options: Options = {},
): string {
  const { baseCps = 80, backlogMultiplier = 3, maxCps = 500 } = options
  const [displayed, setDisplayed] = useState(isStreaming ? '' : target)
  const targetRef = useRef(target)
  targetRef.current = target

  // Snap to the full target whenever streaming flips off so users don't
  // wait for the typewriter to catch up on a finalized message.
  useEffect(() => {
    if (!isStreaming) {
      setDisplayed(target)
    }
  }, [isStreaming, target])

  useEffect(() => {
    if (!isStreaming) return
    let raf = 0
    let lastTime = performance.now()
    const step = (now: number) => {
      const dt = now - lastTime
      lastTime = now
      setDisplayed((prev) => {
        const t = targetRef.current
        if (prev === t) return prev
        // Target diverged (new segment) — reset the typewriter.
        if (!t.startsWith(prev)) return ''
        const backlog = t.length - prev.length
        const cps = Math.min(
          maxCps,
          Math.max(baseCps, backlog * backlogMultiplier),
        )
        const advance = Math.max(1, Math.floor((cps * dt) / 1000))
        return prev + t.slice(prev.length, prev.length + advance)
      })
      raf = requestAnimationFrame(step)
    }
    raf = requestAnimationFrame(step)
    return () => cancelAnimationFrame(raf)
  }, [isStreaming, baseCps, backlogMultiplier, maxCps])

  return displayed
}
