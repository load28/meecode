import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import { QaCard } from './index'
import type { AssistantSegment, QaPair } from '../../types'

const text = (s: string): AssistantSegment => ({ kind: 'text', text: s })
const tool = (name: string, summary = ''): AssistantSegment => ({
  kind: 'tool_use', name, summary,
})

const pair = (id: string, segs: AssistantSegment[]): QaPair => ({
  id, user_text: '내 질문', segments: segs, timestamp: '2026-05-18T00:00:00Z',
})

const LONG = 'a'.repeat(600)

describe('QaCard', () => {
  it('답변 본문 미리보기를 렌더', () => {
    const p = pair('a', [text('hello')])
    render(<QaCard pair={p} onExpand={() => {}} />)
    expect(screen.getByText('hello')).toBeInTheDocument()
  })

  it('질문 텍스트를 표시', () => {
    render(<QaCard pair={pair('a', [text('r')])} onExpand={() => {}} />)
    expect(screen.getByText('내 질문')).toBeInTheDocument()
  })

  it('답변이 있으면 길이와 무관하게 전체보기 버튼 노출', () => {
    render(<QaCard pair={pair('short', [text('짧음')])} onExpand={() => {}} />)
    expect(screen.getByRole('button', { name: '답변 전체보기' })).toBeInTheDocument()

    render(<QaCard pair={pair('long', [text(LONG)])} onExpand={() => {}} />)
    expect(screen.getAllByRole('button', { name: '답변 전체보기' }).length).toBeGreaterThan(0)
  })

  it('전체보기 버튼 클릭 시 onExpand 호출', () => {
    const onExpand = vi.fn()
    render(<QaCard pair={pair('a', [text(LONG)])} onExpand={onExpand} />)
    fireEvent.click(screen.getByRole('button', { name: '답변 전체보기' }))
    expect(onExpand).toHaveBeenCalledTimes(1)
  })

  it('segments가 비어 있으면 응답 대기 placeholder + 전체보기 버튼 없음', () => {
    render(<QaCard pair={pair('a', [])} onExpand={() => {}} />)
    expect(screen.getByText('응답 대기 중…')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '답변 전체보기' })).toBeNull()
  })

  it('tool_use는 별도 영역에 inline 표시', () => {
    const p = pair('a', [text(LONG), tool('Bash', 'ls')])
    render(<QaCard pair={p} onExpand={() => {}} />)
    expect(screen.getByText('Bash')).toBeInTheDocument()
  })

  it('답변에서 텍스트 선택 시 코멘트 플로팅 표시', () => {
    const mockRect = {
      top: 100, left: 50, width: 80, height: 20,
      bottom: 120, right: 130, x: 50, y: 100,
      toJSON: () => ({}),
    } as DOMRect
    vi.spyOn(window, 'getSelection').mockReturnValue({
      isCollapsed: false,
      toString: () => '선택',
      getRangeAt: () => ({ getBoundingClientRect: () => mockRect }),
    } as unknown as Selection)

    const { container } = render(
      <QaCard pair={pair('a', [text('짧은 답변 텍스트')])} onExpand={() => {}} />
    )
    fireEvent.mouseUp(container.querySelector('.qa-card__answer')!)
    expect(screen.getByText('💬 코멘트')).toBeInTheDocument()
  })
})
