import { useState, useCallback } from 'react'
import type { SelectionState } from '../types'

interface UseSelectionReturn {
  selection: SelectionState
  handleMouseUp: () => void
  clearSelection: () => void
}

export function useSelection(): UseSelectionReturn {
  const [selection, setSelection] = useState<SelectionState>({ text: '', rect: null })

  const handleMouseUp = useCallback(() => {
    const sel = window.getSelection()
    if (!sel || sel.isCollapsed) {
      setSelection({ text: '', rect: null })
      return
    }
    const text = sel.toString().trim()
    if (!text) {
      setSelection({ text: '', rect: null })
      return
    }
    const rect = sel.getRangeAt(0).getBoundingClientRect()
    setSelection({ text, rect })
  }, [])

  const clearSelection = useCallback(() => {
    setSelection({ text: '', rect: null })
  }, [])

  return { selection, handleMouseUp, clearSelection }
}
