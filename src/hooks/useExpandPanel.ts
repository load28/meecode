import { useCallback, useEffect, useRef, useState } from 'react'
import type { QaPair } from '../types'
import { totalTextChars } from '../utils/segmentHelpers'
import { PERSISTED_FLAG_KEYS } from '../state/persistedFlags'
import { usePersistedBoolean } from './usePersistedBoolean'

const AUTO_THRESHOLD = 500

interface UseExpandPanelReturn {
  expandedId: string | null
  setExpandedId: (id: string | null) => void
  isOpen: boolean
  toggleOpen: () => void
  autoExpand: boolean
  setAutoExpand: (v: boolean) => void
}

export function useExpandPanel(pairs: QaPair[]): UseExpandPanelReturn {
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [isOpen, setIsOpen] = useState(false)
  const [autoExpand, setAutoExpand] = usePersistedBoolean(
    PERSISTED_FLAG_KEYS.autoExpand,
    true,
  )
  const lastSeenRef = useRef<string | null>(null)

  const toggleOpen = useCallback(() => {
    setIsOpen((prev) => !prev)
  }, [])

  useEffect(() => {
    if (pairs.length === 0) return
    const newest = pairs[pairs.length - 1]
    if (lastSeenRef.current === newest.id) return
    lastSeenRef.current = newest.id

    // When the panel is already open, always follow the latest Q&A —
    // the user is reading on the side and expects the view to track
    // incoming turns.
    if (isOpen) {
      setExpandedId(newest.id)
      return
    }
    // When closed, fall back to the length-based auto-expand heuristic
    // (only if the user has opted in).
    if (!autoExpand) return
    if (totalTextChars(newest.segments) > AUTO_THRESHOLD) {
      setExpandedId(newest.id)
      setIsOpen(true)
    }
  }, [pairs, autoExpand, isOpen])

  return {
    expandedId,
    setExpandedId,
    isOpen,
    toggleOpen,
    autoExpand,
    setAutoExpand,
  }
}
