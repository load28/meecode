import { renderHook, act, waitFor } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { listen } from '@tauri-apps/api/event'
import { usePtyStream } from './usePtyStream'
import type { QaPair } from '../types'

describe('usePtyStream', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('초기 상태: pairs 빈 배열, selectedId null, isVisible false', () => {
    const { result } = renderHook(() => usePtyStream())
    expect(result.current.pairs).toEqual([])
    expect(result.current.selectedId).toBeNull()
    expect(result.current.isVisible).toBe(false)
  })

  it('session:update 수신 시 pairs 채우고 마지막 항목 자동 선택', async () => {
    let handler: ((e: { payload: QaPair[] }) => void) | null = null

    vi.mocked(listen).mockImplementation(async (event, h) => {
      if (event === 'session:update') {
        handler = h as (e: { payload: QaPair[] }) => void
      }
      return () => {}
    })

    const { result } = renderHook(() => usePtyStream())

    const pairs: QaPair[] = [
      { id: 'a', user_text: 'q1', assistant_text: 'r1', timestamp: 't1' },
      { id: 'b', user_text: 'q2', assistant_text: 'r2', timestamp: 't2' },
    ]

    await act(async () => {
      handler?.({ payload: pairs })
    })

    await waitFor(() => {
      expect(result.current.isVisible).toBe(true)
      expect(result.current.pairs).toEqual(pairs)
      expect(result.current.selectedId).toBe('b')
    })
  })

  it('사용자가 선택한 항목은 새 데이터가 와도 유지', async () => {
    let handler: ((e: { payload: QaPair[] }) => void) | null = null
    vi.mocked(listen).mockImplementation(async (event, h) => {
      if (event === 'session:update') {
        handler = h as (e: { payload: QaPair[] }) => void
      }
      return () => {}
    })

    const { result } = renderHook(() => usePtyStream())

    const initial: QaPair[] = [
      { id: 'a', user_text: 'q1', assistant_text: 'r1', timestamp: 't1' },
      { id: 'b', user_text: 'q2', assistant_text: 'r2', timestamp: 't2' },
    ]
    await act(async () => {
      handler?.({ payload: initial })
    })
    act(() => {
      result.current.selectPair('a')
    })

    const updated: QaPair[] = [
      ...initial,
      { id: 'c', user_text: 'q3', assistant_text: 'r3', timestamp: 't3' },
    ]
    await act(async () => {
      handler?.({ payload: updated })
    })

    await waitFor(() => {
      expect(result.current.selectedId).toBe('a')
      expect(result.current.pairs).toHaveLength(3)
    })
  })

  it('selectPair로 활성 항목 변경', async () => {
    let handler: ((e: { payload: QaPair[] }) => void) | null = null
    vi.mocked(listen).mockImplementation(async (event, h) => {
      if (event === 'session:update') {
        handler = h as (e: { payload: QaPair[] }) => void
      }
      return () => {}
    })

    const { result } = renderHook(() => usePtyStream())
    const pairs: QaPair[] = [
      { id: 'a', user_text: 'q1', assistant_text: 'r1', timestamp: 't1' },
      { id: 'b', user_text: 'q2', assistant_text: 'r2', timestamp: 't2' },
    ]
    await act(async () => {
      handler?.({ payload: pairs })
    })

    act(() => {
      result.current.selectPair('a')
    })

    expect(result.current.selectedId).toBe('a')
  })
})
