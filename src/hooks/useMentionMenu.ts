import { useCallback, useEffect, useRef, useState } from 'react'
import { invoke } from '@tauri-apps/api/core'

export interface MentionState {
  startIndex: number
  query: string
}

interface Options {
  value: string
  setValue: (next: string) => void
  textareaRef: React.RefObject<HTMLTextAreaElement | null>
  projectPath: string | undefined
}

export interface UseMentionMenuResult {
  state: MentionState | null
  results: string[]
  selectedIndex: number
  listRef: React.MutableRefObject<HTMLUListElement | null>
  setSelectedIndex: React.Dispatch<React.SetStateAction<number>>
  /** onChange에서 caret 위치로 멘션 상태를 갱신. */
  detect: (text: string, caret: number) => void
  /** Esc 등으로 메뉴를 닫는다. */
  close: () => void
  /** 후보를 선택해 textarea의 `@<query>` 토큰을 `@<path> `로 교체. */
  select: (path: string) => void
  /**
   * textarea onKeyDown에서 호출. 멘션 메뉴가 열려있고 키가 메뉴에 속하면
   * 처리 후 true를 반환. ESC는 닫기, 화살표는 인덱스 이동, Enter/Tab은 선택.
   */
  handleKeyDown: (e: React.KeyboardEvent) => boolean
}

function detectMention(text: string, caret: number): MentionState | null {
  if (caret === 0) return null
  let i = caret - 1
  while (i >= 0) {
    const ch = text[i]
    if (ch === '@') {
      const before = i === 0 ? ' ' : text[i - 1]
      if (before === ' ' || before === '\n' || i === 0) {
        return { startIndex: i, query: text.slice(i + 1, caret) }
      }
      return null
    }
    if (ch === ' ' || ch === '\n' || ch === '\t') return null
    i--
  }
  return null
}

/**
 * Composer의 `@<query>` 멘션 자동완성 상태.
 *
 * - detect(text, caret): textarea 변경 시점에 멘션 활성 여부 갱신.
 * - results: 활성 상태일 때 backend의 search_files로 받아온 후보.
 * - listRef + selectedIndex: 키보드 네비게이션과 scrollIntoView.
 * - select(path): 현재 query를 `@<path> `로 치환하고 캐럿을 그 뒤로.
 */
export function useMentionMenu({
  value,
  setValue,
  textareaRef,
  projectPath,
}: Options): UseMentionMenuResult {
  const [state, setState] = useState<MentionState | null>(null)
  const [results, setResults] = useState<string[]>([])
  const [selectedIndex, setSelectedIndex] = useState(0)
  const listRef = useRef<HTMLUListElement | null>(null)

  useEffect(() => {
    if (!state) return
    const list = listRef.current
    if (!list) return
    const item = list.children[selectedIndex] as HTMLElement | undefined
    if (item && typeof item.scrollIntoView === 'function') {
      item.scrollIntoView({ block: 'nearest' })
    }
  }, [selectedIndex, state])

  useEffect(() => {
    if (!state || !projectPath) {
      setResults([])
      return
    }
    let alive = true
    const run = async () => {
      try {
        const found = await invoke<string[]>('search_files', {
          args: { project_path: projectPath, query: state.query },
        })
        if (alive) setResults(found)
      } catch {
        if (alive) setResults([])
      }
    }
    run()
    return () => {
      alive = false
    }
  }, [state, projectPath])

  const detect = useCallback((text: string, caret: number) => {
    setState(detectMention(text, caret))
    setSelectedIndex(0)
  }, [])

  const close = useCallback(() => setState(null), [])

  const select = useCallback(
    (path: string) => {
      if (!state) return
      const before = value.slice(0, state.startIndex)
      const after = value.slice(state.startIndex + 1 + state.query.length)
      const inserted = `@${path} `
      const next = before + inserted + after
      setValue(next)
      setState(null)
      const ta = textareaRef.current
      if (ta) {
        const pos = (before + inserted).length
        requestAnimationFrame(() => {
          ta.focus()
          ta.setSelectionRange(pos, pos)
        })
      }
    },
    [state, value, setValue, textareaRef],
  )

  const handleKeyDown = (e: React.KeyboardEvent): boolean => {
    if (!state || results.length === 0) return false
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setSelectedIndex((i) => Math.min(i + 1, results.length - 1))
      return true
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault()
      setSelectedIndex((i) => Math.max(i - 1, 0))
      return true
    }
    if ((e.key === 'Enter' && !e.shiftKey) || e.key === 'Tab') {
      e.preventDefault()
      const pick = results[Math.min(selectedIndex, results.length - 1)]
      if (pick) select(pick)
      return true
    }
    return false
  }

  return {
    state,
    results,
    selectedIndex,
    listRef,
    setSelectedIndex,
    detect,
    close,
    select,
    handleKeyDown,
  }
}
