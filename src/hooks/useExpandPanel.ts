import { useCallback, useEffect, useRef, useState } from 'react'
import type { QaPair } from '../types'
import { totalTextChars } from '../utils/segmentHelpers'

const STORAGE_KEY = 'meecode.autoExpand'
const AUTO_THRESHOLD = 500

interface UseExpandPanelReturn {
  expandedId: string | null
  setExpandedId: (id: string | null) => void
  isOpen: boolean
  toggleOpen: () => void
  autoExpand: boolean
  setAutoExpand: (v: boolean) => void
}

function readAutoExpand(): boolean {
  const stored = localStorage.getItem(STORAGE_KEY)
  if (stored === null) return true
  return stored !== 'false'
}

export function useExpandPanel(pairs: QaPair[]): UseExpandPanelReturn {
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [isOpen, setIsOpen] = useState(false)
  const [autoExpand, setAutoExpandState] = useState<boolean>(readAutoExpand)
  const lastSeenRef = useRef<string | null>(null)

  const setAutoExpand = useCallback((v: boolean) => {
    setAutoExpandState(v)
    localStorage.setItem(STORAGE_KEY, String(v))
  }, [])

  const toggleOpen = useCallback(() => {
    setIsOpen((prev) => !prev)
  }, [])

  useEffect(() => {
    if (!autoExpand) return
    if (pairs.length === 0) return
    const newest = pairs[pairs.length - 1]
    if (lastSeenRef.current === newest.id) return
    lastSeenRef.current = newest.id
    if (totalTextChars(newest.segments) > AUTO_THRESHOLD) {
      setExpandedId(newest.id)
      setIsOpen(true)
    }
  }, [pairs, autoExpand])

  return {
    expandedId,
    setExpandedId,
    isOpen,
    toggleOpen,
    autoExpand,
    setAutoExpand,
  }
}
