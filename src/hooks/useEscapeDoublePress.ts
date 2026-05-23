import { useCallback, useRef, useState } from 'react'

const DOUBLE_PRESS_WINDOW_MS = 1000

export interface UseEscapeDoublePressResult {
  /** Whether the hint ("press Esc again to clear") should be shown. */
  hintVisible: boolean
  /**
   * Arm the double-press. On first call, returns `false` and schedules a
   * timer that hides the hint after the window. On the second call inside
   * the window, returns `true` (caller should run its clear action) and
   * resets the armed flag.
   */
  press: () => boolean
  /** Cancel an armed state — e.g. because the user typed something. */
  reset: () => void
}

/**
 * CLI-parity double-press detector for the ESC key.
 *
 * First press arms the action and shows the hint. Second press within
 * `DOUBLE_PRESS_WINDOW_MS` returns true (caller performs the clear). If
 * the second press never arrives, a timer hides the hint automatically.
 * `reset()` is for outside events that should disarm (e.g. text input).
 */
export function useEscapeDoublePress(): UseEscapeDoublePressResult {
  const [hintVisible, setHintVisible] = useState(false)
  const armedAtRef = useRef<number | null>(null)

  const reset = useCallback(() => {
    if (armedAtRef.current === null && !hintVisible) return
    armedAtRef.current = null
    setHintVisible(false)
  }, [hintVisible])

  const press = useCallback((): boolean => {
    const now = Date.now()
    const armedAt = armedAtRef.current
    if (armedAt !== null && now - armedAt <= DOUBLE_PRESS_WINDOW_MS) {
      armedAtRef.current = null
      setHintVisible(false)
      return true
    }
    armedAtRef.current = now
    setHintVisible(true)
    window.setTimeout(() => {
      if (armedAtRef.current === now) {
        armedAtRef.current = null
        setHintVisible(false)
      }
    }, DOUBLE_PRESS_WINDOW_MS)
    return false
  }, [])

  return { hintVisible, press, reset }
}
