import { renderHook, act } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { useSelection } from './useSelection'

describe('useSelection', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('초기 상태에서 text가 빈 문자열, rect가 null', () => {
    vi.spyOn(window, 'getSelection').mockReturnValue(null)
    const { result } = renderHook(() => useSelection())
    expect(result.current.selection.text).toBe('')
    expect(result.current.selection.rect).toBeNull()
  })

  it('텍스트 선택 시 text와 rect를 캡처', () => {
    const mockRect = {
      top: 100, left: 50, width: 100, height: 20,
      bottom: 120, right: 150, x: 50, y: 100,
      toJSON: () => ({}),
    } as DOMRect

    vi.spyOn(window, 'getSelection').mockReturnValue({
      isCollapsed: false,
      toString: () => 'await를 사용',
      getRangeAt: () => ({ getBoundingClientRect: () => mockRect }),
    } as unknown as Selection)

    const { result } = renderHook(() => useSelection())
    act(() => { result.current.handleMouseUp() })

    expect(result.current.selection.text).toBe('await를 사용')
    expect(result.current.selection.rect).toBe(mockRect)
  })

  it('빈 선택(isCollapsed)이면 selection 초기화', () => {
    vi.spyOn(window, 'getSelection').mockReturnValue({
      isCollapsed: true,
    } as unknown as Selection)

    const { result } = renderHook(() => useSelection())
    act(() => { result.current.handleMouseUp() })

    expect(result.current.selection.text).toBe('')
    expect(result.current.selection.rect).toBeNull()
  })

  it('clearSelection 호출 시 상태 초기화', () => {
    const mockRect = {
      top: 100, left: 50, width: 100, height: 20,
      bottom: 120, right: 150, x: 50, y: 100,
      toJSON: () => ({}),
    } as DOMRect

    vi.spyOn(window, 'getSelection').mockReturnValue({
      isCollapsed: false,
      toString: () => 'some text',
      getRangeAt: () => ({ getBoundingClientRect: () => mockRect }),
    } as unknown as Selection)

    const { result } = renderHook(() => useSelection())
    act(() => { result.current.handleMouseUp() })
    expect(result.current.selection.text).toBe('some text')

    act(() => { result.current.clearSelection() })
    expect(result.current.selection.text).toBe('')
    expect(result.current.selection.rect).toBeNull()
  })
})
