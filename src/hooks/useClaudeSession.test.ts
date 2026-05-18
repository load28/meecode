import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'
import { useClaudeSession } from './useClaudeSession'
import type { QaPair, ToolRequest } from '../types'

type Handler = (event: { payload: unknown }) => void
const listeners: Record<string, Handler[]> = {}

vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn((evt: string, cb: Handler) => {
    ;(listeners[evt] ??= []).push(cb)
    return Promise.resolve(() => {
      listeners[evt] = (listeners[evt] || []).filter((h) => h !== cb)
    })
  }),
}))

const invokeMock = vi.fn().mockResolvedValue(undefined)
vi.mock('@tauri-apps/api/core', () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
}))

const fire = (evt: string, payload: unknown) =>
  (listeners[evt] || []).forEach((cb) => cb({ payload }))

const pair = (id: string): QaPair => ({
  id,
  user_text: 'q',
  segments: [],
  timestamp: 't',
})

beforeEach(() => {
  for (const k of Object.keys(listeners)) delete listeners[k]
  invokeMock.mockClear()
})

describe('useClaudeSession', () => {
  it('초기 상태', () => {
    const { result } = renderHook(() => useClaudeSession())
    expect(result.current.pairs).toEqual([])
    expect(result.current.pendingTool).toBeNull()
    expect(result.current.mode).toBe('default')
  })

  it('session:history로 pairs 초기화', async () => {
    const { result } = renderHook(() => useClaudeSession())
    await waitFor(() =>
      expect(listeners['session:history']?.length).toBeGreaterThan(0),
    )
    act(() => fire('session:history', [pair('a'), pair('b')]))
    expect(result.current.pairs).toHaveLength(2)
    expect(result.current.pairs[0].id).toBe('a')
  })

  it('session:tool_request로 pendingTool 설정 (tool_use_id 포함)', async () => {
    const { result } = renderHook(() => useClaudeSession())
    await waitFor(() =>
      expect(listeners['session:tool_request']?.length).toBeGreaterThan(0),
    )
    const req: ToolRequest = {
      request_id: 'r1',
      tool_name: 'Bash',
      input: { command: 'ls' },
      tool_use_id: 'tu-1',
    }
    act(() => fire('session:tool_request', req))
    expect(result.current.pendingTool).toEqual(req)
  })

  it('respondTool은 invoke 후 pendingTool을 비운다', async () => {
    const { result } = renderHook(() => useClaudeSession())
    await waitFor(() =>
      expect(listeners['session:tool_request']?.length).toBeGreaterThan(0),
    )
    act(() =>
      fire('session:tool_request', {
        request_id: 'r1',
        tool_name: 'Edit',
        input: {},
        tool_use_id: 'tu-9',
      }),
    )
    await act(async () => {
      await result.current.respondTool('r1', true, 'tu-9')
    })
    expect(invokeMock).toHaveBeenCalledWith('send_tool_response', {
      args: { request_id: 'r1', allow: true, tool_use_id: 'tu-9' },
    })
    expect(result.current.pendingTool).toBeNull()
  })

  it('sendUserMessage는 invoke로 텍스트를 보낸다', async () => {
    const { result } = renderHook(() => useClaudeSession())
    await act(async () => {
      await result.current.sendUserMessage('hello')
    })
    expect(invokeMock).toHaveBeenCalledWith('send_user_message', { text: 'hello' })
  })

  it('cycleMode는 클라이언트 사이드로 default→plan→auto-accept→default 순회', () => {
    const { result } = renderHook(() => useClaudeSession())
    expect(result.current.mode).toBe('default')
    act(() => result.current.cycleMode())
    expect(result.current.mode).toBe('plan')
    act(() => result.current.cycleMode())
    expect(result.current.mode).toBe('auto-accept')
    act(() => result.current.cycleMode())
    expect(result.current.mode).toBe('default')
  })

  it('session:message로 같은 id 페어 갱신', async () => {
    const { result } = renderHook(() => useClaudeSession())
    await waitFor(() =>
      expect(listeners['session:message']?.length).toBeGreaterThan(0),
    )
    act(() => fire('session:history', [pair('a')]))
    const updated: QaPair = {
      id: 'a',
      user_text: 'q',
      segments: [{ kind: 'text', text: 'answer' }],
      timestamp: 't',
    }
    act(() => fire('session:message', updated))
    expect(result.current.pairs).toHaveLength(1)
    expect(result.current.pairs[0].segments).toEqual([
      { kind: 'text', text: 'answer' },
    ])
  })
})
