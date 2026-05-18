import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ChatComposer } from './index'

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn().mockResolvedValue(undefined),
}))
import { invoke } from '@tauri-apps/api/core'

describe('ChatComposer', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('Enter 입력 시 write_input 호출, 텍스트 끝에 CR', async () => {
    render(<ChatComposer />)
    const ta = screen.getByRole('textbox') as HTMLTextAreaElement
    fireEvent.change(ta, { target: { value: 'hello' } })
    fireEvent.keyDown(ta, { key: 'Enter' })
    expect(invoke).toHaveBeenCalledWith('write_input', { text: 'hello\r' })
  })

  it('Shift+Enter는 줄바꿈만, write_input 호출 안 함', () => {
    render(<ChatComposer />)
    const ta = screen.getByRole('textbox') as HTMLTextAreaElement
    fireEvent.change(ta, { target: { value: 'hello' } })
    fireEvent.keyDown(ta, { key: 'Enter', shiftKey: true })
    expect(invoke).not.toHaveBeenCalled()
  })

  it('전송 후 textarea 비움', async () => {
    render(<ChatComposer />)
    const ta = screen.getByRole('textbox') as HTMLTextAreaElement
    fireEvent.change(ta, { target: { value: 'q' } })
    fireEvent.keyDown(ta, { key: 'Enter' })
    await new Promise((r) => setTimeout(r, 0))
    expect(ta.value).toBe('')
  })

  it('IME composition 중 Enter는 차단', () => {
    render(<ChatComposer />)
    const ta = screen.getByRole('textbox') as HTMLTextAreaElement
    fireEvent.compositionStart(ta)
    fireEvent.change(ta, { target: { value: '한' } })
    fireEvent.keyDown(ta, { key: 'Enter', keyCode: 229 })
    expect(invoke).not.toHaveBeenCalled()
  })

  it('ESC 버튼은 \\x1b 전송', () => {
    render(<ChatComposer />)
    fireEvent.click(screen.getByRole('button', { name: 'ESC' }))
    expect(invoke).toHaveBeenCalledWith('write_input', { text: '\x1b' })
  })

  it('Shift+Tab 버튼은 \\x1b[Z 전송', () => {
    render(<ChatComposer />)
    fireEvent.click(screen.getByRole('button', { name: 'Shift+Tab' }))
    expect(invoke).toHaveBeenCalledWith('write_input', { text: '\x1b[Z' })
  })

  it('Ctrl+C 버튼은 \\x03 전송', () => {
    render(<ChatComposer />)
    fireEvent.click(screen.getByRole('button', { name: 'Ctrl+C' }))
    expect(invoke).toHaveBeenCalledWith('write_input', { text: '\x03' })
  })

  it('/ 입력 시 슬래시 명령 팝오버 표시', () => {
    render(<ChatComposer />)
    const ta = screen.getByRole('textbox') as HTMLTextAreaElement
    fireEvent.change(ta, { target: { value: '/' } })
    expect(screen.getByText('/help')).toBeInTheDocument()
    expect(screen.getByText('/clear')).toBeInTheDocument()
  })

  it('write_input 실패 시 에러 메시지 표시, 텍스트 보존', async () => {
    ;(invoke as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('pty closed'))
    render(<ChatComposer />)
    const ta = screen.getByRole('textbox') as HTMLTextAreaElement
    fireEvent.change(ta, { target: { value: 'q' } })
    fireEvent.keyDown(ta, { key: 'Enter' })
    await new Promise((r) => setTimeout(r, 0))
    expect(screen.getByRole('alert').textContent).toContain('pty closed')
    expect(ta.value).toBe('q')
  })
})
