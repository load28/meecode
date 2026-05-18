import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { invoke } from '@tauri-apps/api/core'
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

  it('💬 코멘트 버튼을 초기에 렌더링', () => {
    render(<CommentFloat selection={mockSelection} onClose={() => {}} />)
    expect(screen.getByText('💬 코멘트')).toBeInTheDocument()
  })

  it('버튼 클릭 시 버튼 사라지고 인풋창 표시', async () => {
    const user = userEvent.setup()
    render(<CommentFloat selection={mockSelection} onClose={() => {}} />)

    await user.click(screen.getByText('💬 코멘트'))

    expect(screen.queryByText('💬 코멘트')).not.toBeInTheDocument()
    expect(screen.getByPlaceholderText('질문을 입력하세요...')).toBeInTheDocument()
  })

  it('엔터 제출 시 [선택: "..."] 포맷으로 send_user_message 호출', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    render(<CommentFloat selection={mockSelection} onClose={onClose} />)

    await user.click(screen.getByText('💬 코멘트'))
    await user.type(screen.getByPlaceholderText('질문을 입력하세요...'), 'async 없으면?')
    await user.keyboard('{Enter}')

    expect(invoke).toHaveBeenCalledWith('send_user_message', {
      text: '[선택: "await를 사용"] async 없으면?',
    })
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('전송 버튼 클릭으로도 제출 가능', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    render(<CommentFloat selection={mockSelection} onClose={onClose} />)

    await user.click(screen.getByText('💬 코멘트'))
    await user.type(screen.getByPlaceholderText('질문을 입력하세요...'), '질문 내용')
    await user.click(screen.getByText('전송'))

    expect(invoke).toHaveBeenCalledWith('send_user_message', {
      text: '[선택: "await를 사용"] 질문 내용',
    })
  })

  it('ESC 키로 닫기', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    render(<CommentFloat selection={mockSelection} onClose={onClose} />)

    await user.keyboard('{Escape}')
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('빈 입력은 제출하지 않음', async () => {
    const user = userEvent.setup()
    render(<CommentFloat selection={mockSelection} onClose={() => {}} />)

    await user.click(screen.getByText('💬 코멘트'))
    await user.keyboard('{Enter}')

    expect(invoke).not.toHaveBeenCalled()
  })
})
