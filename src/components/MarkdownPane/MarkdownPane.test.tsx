import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { MarkdownPane } from './index'

describe('MarkdownPane', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('마크다운을 HTML로 렌더링', () => {
    const { container } = render(<MarkdownPane content="# 안녕하세요\n\n본문 텍스트" isVisible={true} />)
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('안녕하세요')
    expect(container.querySelector('.markdown-pane__content')?.textContent).toContain('본문 텍스트')
  })

  it('isVisible=false 시 숨김 처리', () => {
    const { container } = render(<MarkdownPane content="# 제목" isVisible={false} />)
    const pane = container.querySelector('.markdown-pane')
    expect(pane).toHaveStyle('display: none')
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

    const { container } = render(
      <MarkdownPane content="# 제목\n\n선택된 텍스트입니다" isVisible={true} />
    )

    fireEvent.mouseUp(container.querySelector('.markdown-pane')!)

    expect(screen.getByText('💬 코멘트')).toBeInTheDocument()
  })
})
