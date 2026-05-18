import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { MarkdownPane } from './index'
import type { QaPair } from '../../types'

const pair = (id: string, q: string, a: string): QaPair => ({
  id,
  user_text: q,
  assistant_text: a,
  timestamp: '2026-05-18T00:00:00Z',
})

describe('MarkdownPane', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('선택된 페어의 마크다운을 HTML로 렌더링', () => {
    const pairs = [pair('a', '안녕', '# 안녕하세요\n\n본문 텍스트')]
    const { container } = render(
      <MarkdownPane pairs={pairs} selectedId="a" onSelect={() => {}} isVisible={true} />
    )
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('안녕하세요')
    expect(container.querySelector('.markdown-pane__content')?.textContent).toContain('본문 텍스트')
  })

  it('선택된 페어의 질문을 표시', () => {
    const pairs = [pair('a', '내 질문', '답변')]
    render(
      <MarkdownPane pairs={pairs} selectedId="a" onSelect={() => {}} isVisible={true} />
    )
    expect(screen.getByText('내 질문')).toBeInTheDocument()
  })

  it('isVisible=false 시 숨김 처리', () => {
    const pairs = [pair('a', 'q', 'r')]
    const { container } = render(
      <MarkdownPane pairs={pairs} selectedId="a" onSelect={() => {}} isVisible={false} />
    )
    const pane = container.querySelector('.markdown-pane')
    expect(pane).toHaveStyle('display: none')
  })

  it('선택된 항목이 없으면 placeholder 표시', () => {
    const pairs = [pair('a', 'q', 'r')]
    render(
      <MarkdownPane pairs={pairs} selectedId={null} onSelect={() => {}} isVisible={true} />
    )
    expect(screen.getByText('좌측에서 항목을 선택하세요')).toBeInTheDocument()
  })

  it('MessageList 항목 클릭 시 onSelect 호출', () => {
    const onSelect = vi.fn()
    const pairs = [
      pair('a', '질문1', '답변1'),
      pair('b', '질문2', '답변2'),
    ]
    render(
      <MarkdownPane pairs={pairs} selectedId="a" onSelect={onSelect} isVisible={true} />
    )
    fireEvent.click(screen.getByText(/질문2/))
    expect(onSelect).toHaveBeenCalledWith('b')
  })

  it('텍스트 선택 시 CommentFloat 표시', () => {
    const mockRect = {
      top: 100, left: 50, width: 80, height: 20,
      bottom: 120, right: 130, x: 50, y: 100,
      toJSON: () => ({}),
    } as DOMRect

    vi.spyOn(window, 'getSelection').mockReturnValue({
      isCollapsed: false,
      toString: () => '선택된 텍스트',
      getRangeAt: () => ({ getBoundingClientRect: () => mockRect }),
    } as unknown as Selection)

    const pairs = [pair('a', 'q', '# 제목\n\n선택된 텍스트입니다')]
    const { container } = render(
      <MarkdownPane pairs={pairs} selectedId="a" onSelect={() => {}} isVisible={true} />
    )

    fireEvent.mouseUp(container.querySelector('.markdown-pane__body')!)

    expect(screen.getByText('💬 코멘트')).toBeInTheDocument()
  })
})
