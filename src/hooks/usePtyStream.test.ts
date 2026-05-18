import { renderHook, act, waitFor } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { listen } from '@tauri-apps/api/event'
import { usePtyStream } from './usePtyStream'

describe('usePtyStream', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('초기 상태: markdownContent 빈 문자열, isMarkdownVisible false', () => {
    const { result } = renderHook(() => usePtyStream())
    expect(result.current.markdownContent).toBe('')
    expect(result.current.isMarkdownVisible).toBe(false)
  })

  it('md:update 이벤트 수신 시 마크다운 상태 업데이트', async () => {
    let mdHandler: ((e: { payload: string }) => void) | null = null

    vi.mocked(listen).mockImplementation(async (event, handler) => {
      if (event === 'md:update') {
        mdHandler = handler as (e: { payload: string }) => void
      }
      return () => {}
    })

    const { result } = renderHook(() => usePtyStream())

    await act(async () => {
      mdHandler?.({ payload: '# 제목\n\n본문 내용' })
    })

    await waitFor(() => {
      expect(result.current.isMarkdownVisible).toBe(true)
      expect(result.current.markdownContent).toBe('# 제목\n\n본문 내용')
    })
  })

  it('md:update 이벤트마다 content 업데이트', async () => {
    let mdHandler: ((e: { payload: string }) => void) | null = null

    vi.mocked(listen).mockImplementation(async (event, handler) => {
      if (event === 'md:update') {
        mdHandler = handler as (e: { payload: string }) => void
      }
      return () => {}
    })

    const { result } = renderHook(() => usePtyStream())

    await act(async () => {
      mdHandler?.({ payload: '# 첫 번째 응답' })
    })
    await act(async () => {
      mdHandler?.({ payload: '# 두 번째 응답 (더 긴 내용)' })
    })

    await waitFor(() => {
      expect(result.current.markdownContent).toBe('# 두 번째 응답 (더 긴 내용)')
    })
  })
})
