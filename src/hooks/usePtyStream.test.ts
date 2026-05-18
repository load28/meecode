import { describe, it, expect, vi } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'
import { usePtyStream } from './usePtyStream'
import type { QaPair } from '../types'

type Handler = (event: { payload: QaPair[] }) => void
const listeners: Handler[] = []

vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn((_evt: string, cb: Handler) => {
    listeners.push(cb)
    return Promise.resolve(() => {
      const i = listeners.indexOf(cb)
      if (i >= 0) listeners.splice(i, 1)
    })
  }),
}))

const pair = (id: string): QaPair => ({
  id, user_text: 'q', segments: [], timestamp: 't',
})

describe('usePtyStream', () => {
  it('초기 pairs는 빈 배열', () => {
    const { result } = renderHook(() => usePtyStream())
    expect(result.current.pairs).toEqual([])
  })

  it('session:update 이벤트로 pairs 갱신', async () => {
    const { result } = renderHook(() => usePtyStream())
    await waitFor(() => expect(listeners.length).toBeGreaterThan(0))
    act(() => {
      listeners.forEach((cb) => cb({ payload: [pair('a'), pair('b')] }))
    })
    expect(result.current.pairs).toHaveLength(2)
  })
})
