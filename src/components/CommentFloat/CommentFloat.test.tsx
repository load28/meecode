import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { CommentFloat } from './index'

const mockRect = {
  top: 200, left: 100, width: 80, height: 20,
  bottom: 220, right: 180, x: 100, y: 200,
  toJSON: () => ({}),
} as DOMRect

const mockSelection = { text: 'await를 사용', rect: mockRect }

describe('CommentFloat', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('onAddComment 제공 시 코멘트 추가 버튼 렌더링', () => {
    render(
      <CommentFloat
        selection={mockSelection}
        onClose={() => {}}
        onAddComment={() => {}}
      />,
    )
    expect(screen.getByText('코멘트로 추가')).toBeInTheDocument()
  })

  it('버튼 클릭 시 onAddComment(선택텍스트) 호출 후 onClose', async () => {
    const user = userEvent.setup()
    const onAddComment = vi.fn()
    const onClose = vi.fn()
    render(
      <CommentFloat
        selection={mockSelection}
        onClose={onClose}
        onAddComment={onAddComment}
      />,
    )

    await user.click(screen.getByText('코멘트로 추가'))

    expect(onAddComment).toHaveBeenCalledWith('await를 사용')
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('ESC 키로 닫기', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    render(
      <CommentFloat
        selection={mockSelection}
        onClose={onClose}
        onAddComment={() => {}}
      />,
    )

    await user.keyboard('{Escape}')
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('onPin 미제공 시 핀 버튼 숨김', () => {
    render(
      <CommentFloat
        selection={mockSelection}
        onClose={() => {}}
        onAddComment={() => {}}
      />,
    )
    expect(screen.queryByText(/핀/)).not.toBeInTheDocument()
  })

  it('onPin 제공 시 핀 버튼 표시 및 클릭 시 호출', async () => {
    const user = userEvent.setup()
    const onPin = vi.fn().mockResolvedValue(undefined)
    render(
      <CommentFloat
        selection={mockSelection}
        onClose={() => {}}
        onAddComment={() => {}}
        onPin={onPin}
      />,
    )

    await user.click(screen.getByText('핀'))
    expect(onPin).toHaveBeenCalledWith('await를 사용')
  })

  it('onAddComment 미제공 시 코멘트 버튼 숨김', () => {
    render(<CommentFloat selection={mockSelection} onClose={() => {}} />)
    expect(screen.queryByText('코멘트로 추가')).not.toBeInTheDocument()
  })
})
