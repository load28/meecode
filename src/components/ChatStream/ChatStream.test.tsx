import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import { ChatStream } from './index'
import type { QaPair, AssistantSegment } from '../../types'

const text = (s: string): AssistantSegment => ({ kind: 'text', text: s })
const pair = (id: string, q: string, segs: AssistantSegment[]): QaPair => ({
  id, user_text: q, segments: segs, timestamp: '2026-05-18T00:00:00Z',
})

describe('ChatStream', () => {
  it('빈 pairs일 때 빈 상태 안내', () => {
    render(<ChatStream pairs={[]} expandedId={null} onExpand={() => {}} />)
    expect(screen.getByText(/첫 질문/)).toBeInTheDocument()
  })

  it('pairs를 시간순으로 카드 렌더', () => {
    const pairs = [
      pair('a', '첫째 질문', [text('첫 답변')]),
      pair('b', '둘째 질문', [text('둘째 답변')]),
    ]
    render(<ChatStream pairs={pairs} expandedId={null} onExpand={() => {}} />)
    expect(screen.getByText('첫째 질문')).toBeInTheDocument()
    expect(screen.getByText('둘째 질문')).toBeInTheDocument()
  })

  it('전체보기 버튼 클릭 시 onExpand(id) 호출', () => {
    const onExpand = vi.fn()
    const long = 'a'.repeat(600)
    const pairs = [pair('a', 'q', [text(long)])]
    render(<ChatStream pairs={pairs} expandedId={null} onExpand={onExpand} />)
    fireEvent.click(screen.getByRole('button', { name: '답변 전체보기' }))
    expect(onExpand).toHaveBeenCalledWith('a')
  })

  it('expandedId와 일치하는 카드는 안내 메시지', () => {
    const long = 'a'.repeat(600)
    const pairs = [pair('a', 'q', [text(long)])]
    render(<ChatStream pairs={pairs} expandedId="a" onExpand={() => {}} />)
    expect(screen.getByText('오른쪽 패널에 펼쳐짐')).toBeInTheDocument()
  })

  it('마지막 페어 segments가 비어 있으면 "Claude가 응답 대기 중" 인디케이터 표시', () => {
    const pairs = [pair('a', 'q', [])]
    render(<ChatStream pairs={pairs} expandedId={null} onExpand={() => {}} />)
    expect(screen.getByText('Claude가 응답 대기 중…')).toBeInTheDocument()
  })

  it('마지막 segment가 tool_use면 도구 실행 인디케이터 표시', () => {
    const tool = { kind: 'tool_use' as const, name: 'Bash', summary: 'ls' }
    const pairs = [pair('a', 'q', [tool])]
    render(<ChatStream pairs={pairs} expandedId={null} onExpand={() => {}} />)
    expect(screen.getByText('Claude가 도구를 실행 중…')).toBeInTheDocument()
  })
})
