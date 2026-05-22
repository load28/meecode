import { useEffect, useRef, useState } from 'react'
import type { SlashCommand } from '../types'
import {
  CLIENT_SLASH_COMMANDS,
  decorateServerSlash,
} from './clientSlash'

/** session:init이 도착하기 전 임시로 보여줄 CLI 내장 명령. */
const FALLBACK_SLASH: ReadonlyArray<SlashCommand> = [
  { name: '/init', description: '프로젝트 초기화 (CLAUDE.md 생성)' },
  { name: '/compact', description: '대화 압축' },
  { name: '/context', description: '컨텍스트 현황' },
  { name: '/review', description: '코드 리뷰' },
  { name: '/security-review', description: '보안 리뷰' },
]

function buildSlashList(
  serverCommands: SlashCommand[] | undefined,
): SlashCommand[] {
  const dynamic = serverCommands ?? []
  const seen = new Set<string>()
  const out: SlashCommand[] = []
  for (const c of CLIENT_SLASH_COMMANDS) {
    if (seen.has(c.name)) continue
    seen.add(c.name)
    out.push(c)
  }
  for (const c of dynamic) {
    const key = c.name.startsWith('/') ? c.name : '/' + c.name
    if (seen.has(key)) continue
    seen.add(key)
    out.push(decorateServerSlash({ ...c, name: key }))
  }
  if (dynamic.length === 0) {
    for (const c of FALLBACK_SLASH) {
      if (seen.has(c.name)) continue
      seen.add(c.name)
      out.push(c)
    }
  }
  return out
}

export interface UseSlashMenuResult {
  /** 메뉴를 띄울지 — value가 '/'로 시작할 때 true. */
  show: boolean
  /** 키보드 네비게이션 위치. */
  selectedIndex: number
  /** 메뉴 ul에 붙일 ref (scrollIntoView용). */
  listRef: React.MutableRefObject<HTMLUListElement | null>
  /** 현재 value에 매칭되는 후보 목록. */
  items: SlashCommand[]
  setShow: (open: boolean) => void
  setSelectedIndex: React.Dispatch<React.SetStateAction<number>>
  /** 사용자가 명령을 선택했을 때 호출. value 갱신과 menu 닫기를 한다. */
  select: (cmd: string) => void
}

interface Options {
  value: string
  setValue: (next: string) => void
  serverCommands: SlashCommand[] | undefined
}

/**
 * Composer의 슬래시 명령 팔레트 상태.
 *
 * - 사용자가 textarea에 '/'를 입력하면 부모가 setShow(true)를 호출,
 *   그러면 현재 value prefix와 일치하는 목록을 노출한다.
 * - selectedIndex가 바뀔 때마다 listRef를 통해 활성 아이템을
 *   scrollIntoView한다.
 * - select(cmd)는 value를 'cmd ' 형태로 갱신하고 메뉴를 닫는다.
 */
export function useSlashMenu({
  value,
  setValue,
  serverCommands,
}: Options): UseSlashMenuResult {
  const [show, setShow] = useState(false)
  const [selectedIndex, setSelectedIndex] = useState(0)
  const listRef = useRef<HTMLUListElement | null>(null)

  useEffect(() => {
    if (!show) return
    const list = listRef.current
    if (!list) return
    const item = list.children[selectedIndex] as HTMLElement | undefined
    if (item && typeof item.scrollIntoView === 'function') {
      item.scrollIntoView({ block: 'nearest' })
    }
  }, [selectedIndex, show])

  const all = buildSlashList(serverCommands)
  const q = value.trim().toLowerCase()
  const items = q.startsWith('/')
    ? all.filter((c) => c.name.toLowerCase().startsWith(q))
    : []

  const select = (cmd: string) => {
    setValue(cmd + ' ')
    setShow(false)
  }

  return {
    show,
    selectedIndex,
    listRef,
    items,
    setShow,
    setSelectedIndex,
    select,
  }
}
