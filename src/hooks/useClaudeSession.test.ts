import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useClaudeSession } from './useClaudeSession'
import type { QaPair, ToolRequest } from '../types'

// The store registers Tauri listeners at module load. For unit tests we
// keep `listen()` a no-op (returns an unsubscribe stub) and drive state
// directly through `setTab()` to verify the hook's reducer pipeline.
vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn(() => Promise.resolve(() => {})),
}))

const invokeMock = vi.fn().mockResolvedValue(undefined)
vi.mock('@tauri-apps/api/core', () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
}))

import {
  setTab,
  initialTabSession,
} from '../state/sessionStore'
import { reduceStreamMessage } from './reduceStreamMessage'

const pair = (id: string): QaPair => ({
  id,
  user_text: 'q',
  segments: [],
  timestamp: 't',
})

beforeEach(() => {
  // Reset the store between tests so state doesn't bleed.
  setTab('main', () => initialTabSession())
  invokeMock.mockClear()
})

describe('useClaudeSession', () => {
  it('초기 상태', () => {
    const { result } = renderHook(() => useClaudeSession())
    expect(result.current.pairs).toEqual([])
    expect(result.current.pendingTool).toBeNull()
    expect(result.current.mode).toBe('default')
  })

  it('store에 pairs를 넣으면 hook이 그것을 노출한다', () => {
    const { result } = renderHook(() => useClaudeSession())
    act(() => {
      setTab('main', (s) => ({
        ...s,
        pairs: [pair('a'), pair('b')],
        currentId: 'b',
      }))
    })
    expect(result.current.pairs).toHaveLength(2)
    expect(result.current.pairs[0].id).toBe('a')
  })

  it('store에 pendingTool을 넣으면 hook이 노출한다', () => {
    const { result } = renderHook(() => useClaudeSession())
    const req: ToolRequest = {
      request_id: 'r1',
      tool_name: 'Bash',
      input: { command: 'ls' },
      tool_use_id: 'tu-1',
    }
    act(() => {
      setTab('main', (s) => ({ ...s, pendingTool: req }))
    })
    expect(result.current.pendingTool).toEqual(req)
  })

  it('respondTool은 invoke 후 pendingTool을 비운다', async () => {
    const { result } = renderHook(() => useClaudeSession())
    act(() => {
      setTab('main', (s) => ({
        ...s,
        pendingTool: {
          request_id: 'r1',
          tool_name: 'Edit',
          input: {},
          tool_use_id: 'tu-9',
        } as ToolRequest,
      }))
    })
    await act(async () => {
      await result.current.respondTool('r1', true, 'tu-9')
    })
    expect(invokeMock).toHaveBeenCalledWith('send_tool_response', {
      args: {
        request_id: 'r1',
        allow: true,
        tool_use_id: 'tu-9',
        updated_input: null,
        tab_id: 'main',
      },
    })
    expect(result.current.pendingTool).toBeNull()
  })

  it('sendUserMessage는 invoke로 텍스트를 보낸다', async () => {
    const { result } = renderHook(() => useClaudeSession())
    await act(async () => {
      await result.current.sendUserMessage('hello')
    })
    expect(invokeMock).toHaveBeenCalledWith('send_user_message', {
      text: 'hello',
      images: undefined,
      tabId: 'main',
    })
  })

  it('cycleMode는 default→plan→auto-accept→default 순회', () => {
    const { result } = renderHook(() => useClaudeSession())
    expect(result.current.mode).toBe('default')
    act(() => result.current.cycleMode())
    expect(result.current.mode).toBe('plan')
    act(() => result.current.cycleMode())
    expect(result.current.mode).toBe('auto-accept')
    act(() => result.current.cycleMode())
    expect(result.current.mode).toBe('default')
  })

  it('reduceStreamMessage(assistant) → 마지막 페어에 segments 누적', () => {
    const { result } = renderHook(() => useClaudeSession())
    act(() => {
      setTab('main', (s) => ({ ...s, pairs: [pair('a')], currentId: 'a' }))
    })
    act(() => {
      setTab('main', (s) => {
        const next = reduceStreamMessage(
          { pairs: s.pairs, currentId: s.currentId },
          {
            kind: 'assistant',
            uuid: null,
            body: {
              role: 'assistant',
              content: [{ type: 'text', text: 'answer' }],
            },
          },
        )
        return { ...s, pairs: next.pairs, currentId: next.currentId }
      })
    })
    expect(result.current.pairs).toHaveLength(1)
    expect(result.current.pairs[0].segments).toEqual([
      { kind: 'text', text: 'answer' },
    ])
  })

  it('/clear는 invoke 없이 pairs/queue/turnError를 비운다', async () => {
    const { result } = renderHook(() => useClaudeSession())
    act(() => {
      setTab('main', (s) => ({
        ...s,
        pairs: [pair('a'), pair('b')],
        currentId: 'b',
        queue: [{ id: 'q1', text: 'queued' }],
        turnError: 'oops',
      }))
    })
    await act(async () => {
      await result.current.sendUserMessage('/clear')
    })
    expect(invokeMock).not.toHaveBeenCalled()
    expect(result.current.pairs).toEqual([])
    expect(result.current.queue).toEqual([])
    expect(result.current.turnError).toBeNull()
  })

  it('/exit, /quit도 /clear와 동일하게 동작', async () => {
    const { result } = renderHook(() => useClaudeSession())
    act(() => {
      setTab('main', (s) => ({ ...s, pairs: [pair('x')] }))
    })
    await act(async () => {
      await result.current.sendUserMessage('/exit')
    })
    expect(result.current.pairs).toEqual([])
    act(() => {
      setTab('main', (s) => ({ ...s, pairs: [pair('y')] }))
    })
    await act(async () => {
      await result.current.sendUserMessage('/quit')
    })
    expect(result.current.pairs).toEqual([])
    expect(invokeMock).not.toHaveBeenCalled()
  })

  it('/model <name>은 set_model 호출 후 store에 모델 반영', async () => {
    const { result } = renderHook(() => useClaudeSession())
    await act(async () => {
      await result.current.sendUserMessage('/model claude-sonnet-4-6')
    })
    expect(invokeMock).toHaveBeenCalledWith('set_model', {
      model: 'claude-sonnet-4-6',
      tabId: 'main',
    })
    expect(result.current.model).toBe('claude-sonnet-4-6')
    expect(invokeMock).not.toHaveBeenCalledWith(
      'send_user_message',
      expect.anything(),
    )
  })

  it('/permissions plan은 set_permission_mode 호출 + mode 갱신', async () => {
    const { result } = renderHook(() => useClaudeSession())
    await act(async () => {
      await result.current.sendUserMessage('/permissions plan')
    })
    expect(invokeMock).toHaveBeenCalledWith('set_permission_mode', {
      mode: 'plan',
      tabId: 'main',
    })
    expect(result.current.mode).toBe('plan')
  })

  it('/permissions acceptEdits → auto-accept 모드', async () => {
    const { result } = renderHook(() => useClaudeSession())
    await act(async () => {
      await result.current.sendUserMessage('/permissions acceptEdits')
    })
    expect(invokeMock).toHaveBeenCalledWith('set_permission_mode', {
      mode: 'acceptEdits',
      tabId: 'main',
    })
    expect(result.current.mode).toBe('auto-accept')
  })

  it('/permissions <unknown>은 turnError를 띄우고 invoke는 호출 안 함', async () => {
    const { result } = renderHook(() => useClaudeSession())
    await act(async () => {
      await result.current.sendUserMessage('/permissions bogus')
    })
    expect(invokeMock).not.toHaveBeenCalled()
    expect(result.current.turnError).toMatch(/permissions/)
  })

  it('/init 같은 모델측 슬래시는 그대로 send_user_message로 전달', async () => {
    const { result } = renderHook(() => useClaudeSession())
    await act(async () => {
      await result.current.sendUserMessage('/init')
    })
    expect(invokeMock).toHaveBeenCalledWith('send_user_message', {
      text: '/init',
      images: undefined,
      tabId: 'main',
    })
  })

  it('reduceStreamMessage(user) → 새 페어 시작', () => {
    const { result } = renderHook(() => useClaudeSession())
    act(() => {
      setTab('main', (s) => {
        const next = reduceStreamMessage(
          { pairs: s.pairs, currentId: s.currentId },
          {
            kind: 'user',
            uuid: 'u-fresh',
            body: { role: 'user', content: 'hello' },
          },
        )
        return { ...s, pairs: next.pairs, currentId: next.currentId }
      })
    })
    expect(result.current.pairs).toHaveLength(1)
    expect(result.current.pairs[0].user_text).toBe('hello')
    expect(result.current.pairs[0].id).toBe('u-fresh')
  })
})
