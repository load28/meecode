import { useCallback, useEffect, useRef } from 'react'
import type { QaPair } from '../types'
import { totalTextChars } from '../utils/segmentHelpers'
import { PERSISTED_FLAG_KEYS } from '../state/persistedFlags'
import { usePersistedBoolean } from './usePersistedBoolean'
import { useTabState } from '../state/tabViewStore'

const AUTO_THRESHOLD = 500

interface UseExpandPanelReturn {
  expandedId: string | null
  setExpandedId: (id: string | null) => void
  isOpen: boolean
  toggleOpen: () => void
  autoExpand: boolean
  setAutoExpand: (v: boolean) => void
}

export function useExpandPanel(
  tabId: string,
  pairs: QaPair[],
): UseExpandPanelReturn {
  // Per-tab: which Q&A is expanded, and whether the side pane is open, must
  // travel with the tab (autoExpand stays a global preference).
  const [expandedId, setExpandedId] = useTabState<string | null>(
    tabId,
    'expandedId',
    null,
  )
  const [isOpen, setIsOpen] = useTabState<boolean>(tabId, 'expandOpen', false)
  const [autoExpand, setAutoExpand] = usePersistedBoolean(
    PERSISTED_FLAG_KEYS.autoExpand,
    true,
  )
  // Keyed by tab so the "newest pair" auto-expand heuristic doesn't fire just
  // because switching tabs changed which conversation's tail we're looking at.
  const lastSeenByTab = useRef<Map<string, string>>(new Map())

  const toggleOpen = useCallback(() => {
    setIsOpen((prev) => !prev)
  }, [setIsOpen])

  useEffect(() => {
    if (pairs.length === 0) return
    const newest = pairs[pairs.length - 1]
    if (lastSeenByTab.current.get(tabId) === newest.id) return
    lastSeenByTab.current.set(tabId, newest.id)

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
  }, [pairs, autoExpand, isOpen, tabId, setExpandedId, setIsOpen])

  return {
    expandedId,
    setExpandedId,
    isOpen,
    toggleOpen,
    autoExpand,
    setAutoExpand,
  }
}
