import { useEffect, useMemo, useState } from 'react'
import type { TaskSummary } from '../../types/task'

export interface UseTaskFilterResult {
  query: string
  setQuery: (next: string) => void
  filtered: TaskSummary[]
  focusIdx: number
  setFocusIdx: React.Dispatch<React.SetStateAction<number>>
  /** ArrowDown으로 다음 행. */
  focusNext: () => void
  /** ArrowUp으로 이전 행. */
  focusPrev: () => void
}

/**
 * TaskPicker의 검색 + 결과 필터링 + 키보드 포커스 인덱스 묶음.
 *
 * 필터 결과가 짧아져 현재 인덱스가 마지막을 넘어서면 자동으로 마지막 행에
 * 머무르도록 보정 — 사용자가 검색어를 입력해 행 수가 줄었을 때 인덱스가
 * "허공"을 가리키는 일을 막는다.
 */
export function useTaskFilter(tasks: TaskSummary[]): UseTaskFilterResult {
  const [query, setQuery] = useState('')
  const [focusIdx, setFocusIdx] = useState(0)

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return tasks
    return tasks.filter(
      (t) =>
        t.name.toLowerCase().includes(q) ||
        t.description.toLowerCase().includes(q),
    )
  }, [tasks, query])

  useEffect(() => {
    if (focusIdx >= filtered.length) {
      setFocusIdx(Math.max(0, filtered.length - 1))
    }
  }, [filtered.length, focusIdx])

  const focusNext = () => setFocusIdx((i) => Math.min(filtered.length - 1, i + 1))
  const focusPrev = () => setFocusIdx((i) => Math.max(0, i - 1))

  return { query, setQuery, filtered, focusIdx, setFocusIdx, focusNext, focusPrev }
}
