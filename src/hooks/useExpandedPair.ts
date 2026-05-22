import { useCallback, useMemo } from 'react'
import type { QaPair } from '../types'

interface Options {
  pairs: QaPair[]
  expandedId: string | null
  setExpandedId: (id: string | null) => void
  isOpen: boolean
  toggleOpen: () => void
}

export interface UseExpandedPairResult {
  pair: QaPair | null
  /**
   * QaCard의 ⤢ 버튼이 호출. id에 해당하는 pair를 expand 패널의 활성으로
   * 만들고, 패널이 닫혀있다면 함께 연다.
   */
  expand: (id: string) => void
}

/**
 * '현재 펼쳐진 QaPair' 도출 + '카드의 ⤢ 클릭으로 패널 열기' 액션 묶음.
 *
 * expandedId에 해당하는 pair가 pairs 배열에서 사라지면(예: clear 후) null로
 * 떨어진다.
 */
export function useExpandedPair({
  pairs,
  expandedId,
  setExpandedId,
  isOpen,
  toggleOpen,
}: Options): UseExpandedPairResult {
  const pair = useMemo(
    () => pairs.find((p) => p.id === expandedId) ?? null,
    [pairs, expandedId],
  )
  const expand = useCallback(
    (id: string) => {
      setExpandedId(id)
      if (!isOpen) toggleOpen()
    },
    [setExpandedId, isOpen, toggleOpen],
  )
  return { pair, expand }
}
