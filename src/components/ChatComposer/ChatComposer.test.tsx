import { render, screen, fireEvent, act } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ChatComposer } from './index'
import { clearTabState } from '../../state/tabViewStore'

const handlers = {
  tabId: 'test-tab',
  sendUserMessage: vi.fn().mockResolvedValue(undefined),
  cycleMode: vi.fn(),
}

beforeEach(() => {
  handlers.sendUserMessage.mockClear().mockResolvedValue(undefined)
  handlers.cycleMode.mockClear()
  // Draft/attachments are now per-tab in a module store; reset between tests.
  clearTabState('test-tab')
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

  it('백슬래시+Enter는 줄바꿈을 삽입하고 제출하지 않음 (CLI parity)', () => {
    render(<ChatComposer mode="default" disabled={false} {...handlers} />)
    const ta = screen.getByRole('textbox') as HTMLTextAreaElement
    fireEvent.change(ta, { target: { value: 'first\\' } })
    // selectionStart defaults to end after change in jsdom.
    ta.selectionStart = ta.selectionEnd = ta.value.length
    fireEvent.keyDown(ta, { key: 'Enter' })
    expect(handlers.sendUserMessage).not.toHaveBeenCalled()
    expect(ta.value).toBe('first\n')
  })

  it('Alt+Enter는 줄바꿈을 삽입하고 제출하지 않음', () => {
    render(<ChatComposer mode="default" disabled={false} {...handlers} />)
    const ta = screen.getByRole('textbox') as HTMLTextAreaElement
    fireEvent.change(ta, { target: { value: 'hello' } })
    ta.selectionStart = ta.selectionEnd = ta.value.length
    fireEvent.keyDown(ta, { key: 'Enter', altKey: true })
    expect(handlers.sendUserMessage).not.toHaveBeenCalled()
    expect(ta.value).toBe('hello\n')
  })

  it('전송 시 끝 공백을 trimEnd 처리', async () => {
    render(<ChatComposer mode="default" disabled={false} {...handlers} />)
    const ta = screen.getByRole('textbox') as HTMLTextAreaElement
    fireEvent.change(ta, { target: { value: 'hello   \n  ' } })
    fireEvent.keyDown(ta, { key: 'Enter' })
    expect(handlers.sendUserMessage).toHaveBeenCalledWith('hello', undefined)
  })

  it('ESC 두 번 누르면 입력이 지워짐 (double-press clear)', () => {
    render(<ChatComposer mode="default" disabled={false} {...handlers} />)
    const ta = screen.getByRole('textbox') as HTMLTextAreaElement
    fireEvent.change(ta, { target: { value: 'draft' } })
    fireEvent.keyDown(ta, { key: 'Escape' })
    // First press: hint shown, value preserved.
    expect(ta.value).toBe('draft')
    expect(screen.getByText(/Esc 한 번 더/)).toBeInTheDocument()
    fireEvent.keyDown(ta, { key: 'Escape' })
    expect(ta.value).toBe('')
  })

  it('pendingSelection 도착 시 인풋에 [코멘트 #1 +M줄] 플레이스홀더 삽입', () => {
    const { rerender } = render(
      <ChatComposer mode="default" disabled={false} {...handlers} />,
    )
    const ta = screen.getByRole('textbox') as HTMLTextAreaElement
    fireEvent.change(ta, { target: { value: '이거 설명해줘 ' } })
    ta.selectionStart = ta.selectionEnd = ta.value.length
    rerender(
      <ChatComposer
        mode="default"
        disabled={false}
        {...handlers}
        pendingSelection={{ id: 1, text: 'foo\nbar\nbaz' }}
        onSelectionConsumed={() => {}}
      />,
    )
    expect(ta.value).toContain('[코멘트 #1 +3줄]')
  })

  it('전송 시 플레이스홀더가 펜스 코드 블록으로 치환', async () => {
    const { rerender } = render(
      <ChatComposer mode="default" disabled={false} {...handlers} />,
    )
    const ta = screen.getByRole('textbox') as HTMLTextAreaElement
    fireEvent.change(ta, { target: { value: '' } })
    ta.selectionStart = ta.selectionEnd = 0
    rerender(
      <ChatComposer
        mode="default"
        disabled={false}
        {...handlers}
        pendingSelection={{ id: 7, text: 'const x = 1', source: 'src/a.ts:10' }}
        onSelectionConsumed={() => {}}
      />,
    )
    fireEvent.change(ta, { target: { value: ta.value + ' 이거 뭐임?' } })
    fireEvent.keyDown(ta, { key: 'Enter' })
    await act(async () => {})
    const sent = handlers.sendUserMessage.mock.calls[0][0] as string
    expect(sent).toContain('이거 뭐임?')
    expect(sent).toContain('// src/a.ts:10')
    expect(sent).toContain('const x = 1')
    expect(sent).not.toContain('[코멘트 #')
  })

  it('source 없는 코멘트는 헤더 없이 코드블록만', async () => {
    const { rerender } = render(
      <ChatComposer mode="default" disabled={false} {...handlers} />,
    )
    const ta = screen.getByRole('textbox') as HTMLTextAreaElement
    rerender(
      <ChatComposer
        mode="default"
        disabled={false}
        {...handlers}
        pendingSelection={{ id: 9, text: 'snippet' }}
        onSelectionConsumed={() => {}}
      />,
    )
    fireEvent.change(ta, { target: { value: ta.value + ' q' } })
    fireEvent.keyDown(ta, { key: 'Enter' })
    await act(async () => {})
    const sent = handlers.sendUserMessage.mock.calls[0][0] as string
    expect(sent).toContain('snippet')
    expect(sent).not.toMatch(/\/\/\s/)
  })

  it('여러 코멘트를 하나의 메시지로 합쳐 전송', async () => {
    const { rerender } = render(
      <ChatComposer mode="default" disabled={false} {...handlers} />,
    )
    const ta = screen.getByRole('textbox') as HTMLTextAreaElement
    rerender(
      <ChatComposer
        mode="default"
        disabled={false}
        {...handlers}
        pendingSelection={{ id: 1, text: 'A' }}
        onSelectionConsumed={() => {}}
      />,
    )
    rerender(
      <ChatComposer
        mode="default"
        disabled={false}
        {...handlers}
        pendingSelection={{ id: 2, text: 'B' }}
        onSelectionConsumed={() => {}}
      />,
    )
    expect(ta.value).toContain('[코멘트 #1 +1줄]')
    expect(ta.value).toContain('[코멘트 #2 +1줄]')
    fireEvent.change(ta, { target: { value: ta.value + ' 비교' } })
    fireEvent.keyDown(ta, { key: 'Enter' })
    await act(async () => {})
    const sent = handlers.sendUserMessage.mock.calls[0][0] as string
    expect(sent).toContain('A')
    expect(sent).toContain('B')
    expect(sent).toContain('비교')
  })

  it('진행 중일 때 ESC는 onInterrupt를 호출 (busy=true)', () => {
    const onInterrupt = vi.fn()
    render(
      <ChatComposer
        mode="default"
        disabled={false}
        busy={true}
        onInterrupt={onInterrupt}
        {...handlers}
      />,
    )
    const ta = screen.getByRole('textbox') as HTMLTextAreaElement
    fireEvent.change(ta, { target: { value: 'something' } })
    fireEvent.keyDown(ta, { key: 'Escape' })
    expect(onInterrupt).toHaveBeenCalledTimes(1)
    // Value must be preserved when interrupting (not the double-ESC clear path).
    expect(ta.value).toBe('something')
  })
})
