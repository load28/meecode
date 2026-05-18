import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ChatComposer } from './index'

const handlers = {
  sendUserMessage: vi.fn().mockResolvedValue(undefined),
  cycleMode: vi.fn(),
}

beforeEach(() => {
  handlers.sendUserMessage.mockClear().mockResolvedValue(undefined)
  handlers.cycleMode.mockClear()
})

describe('ChatComposer', () => {
  it('Enter 시 sendUserMessage(텍스트) 호출 — CR 없음', () => {
    render(<ChatComposer mode="default" disabled={false} {...handlers} />)
    const ta = screen.getByRole('textbox') as HTMLTextAreaElement
    fireEvent.change(ta, { target: { value: 'hello' } })
    fireEvent.keyDown(ta, { key: 'Enter' })
    expect(handlers.sendUserMessage).toHaveBeenCalledWith('hello', undefined)
  })

  it('Shift+Enter는 줄바꿈만, sendUserMessage 호출 안 함', () => {
    render(<ChatComposer mode="default" disabled={false} {...handlers} />)
    const ta = screen.getByRole('textbox')
    fireEvent.change(ta, { target: { value: 'hi' } })
    fireEvent.keyDown(ta, { key: 'Enter', shiftKey: true })
    expect(handlers.sendUserMessage).not.toHaveBeenCalled()
  })

  it('전송 성공 후 textarea 비움', async () => {
    render(<ChatComposer mode="default" disabled={false} {...handlers} />)
    const ta = screen.getByRole('textbox') as HTMLTextAreaElement
    fireEvent.change(ta, { target: { value: 'q' } })
    fireEvent.keyDown(ta, { key: 'Enter' })
    await new Promise((r) => setTimeout(r, 0))
    expect(ta.value).toBe('')
  })

  it('IME composition 중 Enter 차단', () => {
    render(<ChatComposer mode="default" disabled={false} {...handlers} />)
    const ta = screen.getByRole('textbox')
    fireEvent.compositionStart(ta)
    fireEvent.change(ta, { target: { value: '한' } })
    fireEvent.keyDown(ta, { key: 'Enter', keyCode: 229 })
    expect(handlers.sendUserMessage).not.toHaveBeenCalled()
  })

  it('Shift+Tab 키 → cycleMode', () => {
    render(<ChatComposer mode="default" disabled={false} {...handlers} />)
    fireEvent.keyDown(screen.getByRole('textbox'), {
      key: 'Tab',
      shiftKey: true,
    })
    expect(handlers.cycleMode).toHaveBeenCalled()
  })

  it('mode prop이 인디케이터에 표시', () => {
    render(<ChatComposer mode="plan" disabled={false} {...handlers} />)
    expect(screen.getByText(/Plan/)).toBeInTheDocument()
  })

  it('disabled일 때 textarea 비활성화', () => {
    render(<ChatComposer mode="default" disabled={true} {...handlers} />)
    expect(screen.getByRole('textbox')).toBeDisabled()
  })

  it('sendUserMessage 실패 시 텍스트 보존 + 에러 표시', async () => {
    handlers.sendUserMessage.mockRejectedValueOnce(new Error('pipe closed'))
    render(<ChatComposer mode="default" disabled={false} {...handlers} />)
    const ta = screen.getByRole('textbox') as HTMLTextAreaElement
    fireEvent.change(ta, { target: { value: 'q' } })
    fireEvent.keyDown(ta, { key: 'Enter' })
    await new Promise((r) => setTimeout(r, 0))
    expect(ta.value).toBe('q')
    expect(screen.getByRole('alert').textContent).toContain('pipe closed')
  })

  it('/ 입력 시 슬래시 명령 팝오버 표시', () => {
    render(<ChatComposer mode="default" disabled={false} {...handlers} />)
    const ta = screen.getByRole('textbox') as HTMLTextAreaElement
    fireEvent.change(ta, { target: { value: '/' } })
    expect(screen.getByText('/help')).toBeInTheDocument()
    expect(screen.getByText('/clear')).toBeInTheDocument()
  })
})
