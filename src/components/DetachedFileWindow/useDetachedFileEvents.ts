import { useEffect, useRef, useState } from 'react'
import { emitTo, listen } from '@tauri-apps/api/event'
import { getCurrentWebviewWindow } from '@tauri-apps/api/webviewWindow'
import type { UseFileTabsResult, OpenOptions } from '../../hooks/useFileTabs'

interface InitPayload {
  paths: string[]
  activePath: string | null
}

interface OpenPayload {
  path: string
  opts?: OpenOptions
}

const MAIN_LABEL = 'main'

export interface UseDetachedFileEventsResult {
  /** init 페이로드가 도착해 탭이 채워졌는지 — 첫 진입 로딩 표시용. */
  hydrated: boolean
}

/**
 * 분리된 파일 패널 창의 IPC 라이프사이클을 캡슐화.
 *
 *   - file:init  → main이 보내는 초기 탭 목록을 받아 hydrate.
 *   - file:open  → main의 추가 open 요청 처리.
 *   - close 요청 → "도킹"으로 변환 — 현재 탭 상태를 main에 file:dock으로
 *     돌려준 뒤 window를 destroy.
 *   - 마운트 직후 file:ready를 main에 보내 init 페이로드 송신을 트리거.
 *
 * 모든 부수 효과는 한 useEffect 안에서 cleanup까지 정렬돼 있어 mount/unmount
 * 한 사이클 안에서 리스너 누락/leakage가 일어나지 않는다.
 */
export function useDetachedFileEvents(
  fileTabs: UseFileTabsResult,
): UseDetachedFileEventsResult {
  const [hydrated, setHydrated] = useState(false)
  // close 콜백이 capture하는 fileTabs는 mount 시점 값이라, 그 뒤로 바뀐
  // 활성 탭/리스트가 닫기 시점에 잘못 전송될 수 있다. ref를 sync해 항상
  // 최신 스냅샷을 보낸다.
  const fileTabsRef = useRef(fileTabs)
  fileTabsRef.current = fileTabs

  useEffect(() => {
    let mounted = true
    const cleanups: Array<() => void> = []

    void (async () => {
      const initUnlisten = await listen<InitPayload>('file:init', (e) => {
        if (!mounted) return
        const { paths, activePath } = e.payload
        paths.forEach((p) => void fileTabsRef.current.open(p))
        if (activePath) fileTabsRef.current.setActive(activePath)
        setHydrated(true)
      })
      cleanups.push(initUnlisten)

      const openUnlisten = await listen<OpenPayload>('file:open', (e) => {
        if (!mounted) return
        void fileTabsRef.current.open(e.payload.path, e.payload.opts)
      })
      cleanups.push(openUnlisten)

      const w = getCurrentWebviewWindow()
      const closeUnlisten = await w.onCloseRequested(async (event) => {
        // "close window"를 "dock back"으로 변환 — 탭 상태를 main에 돌려준
        // 뒤에야 실제로 destroy한다.
        event.preventDefault()
        const snapshot = fileTabsRef.current.tabs.map((t) => t.path)
        const active = fileTabsRef.current.activePath
        await emitTo(MAIN_LABEL, 'file:dock', {
          paths: snapshot,
          activePath: active,
        })
        await w.destroy()
      })
      cleanups.push(closeUnlisten)

      // ready 신호 — main은 이걸 받기 전까지 탭 상태를 보존해두므로 init
      // 페이로드가 손실되지 않는다.
      await emitTo(MAIN_LABEL, 'file:ready', {})
    })()

    return () => {
      mounted = false
      cleanups.forEach((u) => u())
    }
  }, [])

  return { hydrated }
}

export const DETACHED_MAIN_LABEL = MAIN_LABEL
