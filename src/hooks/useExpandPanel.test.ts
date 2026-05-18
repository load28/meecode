import { describe, it, expect, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useExpandPanel } from './useExpandPanel'
import type { QaPair, AssistantSegment } from '../types'

const text = (s: string): AssistantSegment => ({ kind: 'text', text: s })
const pair = (id: string, segs: AssistantSegment[]): QaPair => ({
  id,
  user_text: 'q',
  segments: segs,
  timestamp: '2026-05-18T00:00:00Z',
})

const LONG = 'a'.repeat(600)
const SHORT = 'hi'

describe('useExpandPanel', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('초기 상태: 펼쳐진 페어 없음, 패널 닫힘, autoExpand 기본 true', () => {
    const { result } = renderHook(() => useExpandPanel([]))
    expect(result.current.expandedId).toBeNull()
    expect(result.current.isOpen).toBe(false)
    expect(result.current.autoExpand).toBe(true)
  })

  it('localStorage 값으로 autoExpand 초기화', () => {
    localStorage.setItem('meecode.autoExpand', 'false')
    const { result } = renderHook(() => useExpandPanel([]))
    expect(result.current.autoExpand).toBe(false)
  })

  it('setAutoExpand는 localStorage에도 저장', () => {
    const { result } = renderHook(() => useExpandPanel([]))
    act(() => result.current.setAutoExpand(false))
    expect(result.current.autoExpand).toBe(false)
    expect(localStorage.getItem('meecode.autoExpand')).toBe('false')
  })

  it('긴 답변이 도착하면 자동으로 펼침', () => {
    const { result, rerender } = renderHook(({ pairs }) => useExpandPanel(pairs), {
      initialProps: { pairs: [] as QaPair[] },
    })
    rerender({ pairs: [pair('a', [text(LONG)])] })
    expect(result.current.expandedId).toBe('a')
    expect(result.current.isOpen).toBe(true)
  })

  it('짧은 답변은 자동 전환 안 함', () => {
    const { result, rerender } = renderHook(({ pairs }) => useExpandPanel(pairs), {
      initialProps: { pairs: [] as QaPair[] },
    })
    rerender({ pairs: [pair('a', [text(SHORT)])] })
    expect(result.current.expandedId).toBeNull()
    expect(result.current.isOpen).toBe(false)
  })

  it('autoExpand=false면 긴 답변도 자동 전환 안 함', () => {
    localStorage.setItem('meecode.autoExpand', 'false')
    const { result, rerender } = renderHook(({ pairs }) => useExpandPanel(pairs), {
      initialProps: { pairs: [] as QaPair[] },
    })
    rerender({ pairs: [pair('a', [text(LONG)])] })
    expect(result.current.expandedId).toBeNull()
  })

  it('같은 페어가 segments 누적으로 여러 번 갱신돼도 자동 전환은 1회만', () => {
    const { result, rerender } = renderHook(({ pairs }) => useExpandPanel(pairs), {
      initialProps: { pairs: [pair('a', [text(LONG)])] as QaPair[] },
    })
    expect(result.current.isOpen).toBe(true)
    act(() => result.current.toggleOpen()) // 사용자가 닫음
    expect(result.current.isOpen).toBe(false)
    rerender({ pairs: [pair('a', [text(LONG), text(' more')])] })
    expect(result.current.isOpen).toBe(false) // 같은 id면 재오픈 안 함
  })

  it('setExpandedId/toggleOpen 수동 조작', () => {
    const { result } = renderHook(() => useExpandPanel([pair('a', [text('hi')])]))
    act(() => result.current.setExpandedId('a'))
    expect(result.current.expandedId).toBe('a')
    act(() => result.current.toggleOpen())
    expect(result.current.isOpen).toBe(true)
    act(() => result.current.toggleOpen())
    expect(result.current.isOpen).toBe(false)
  })
})
