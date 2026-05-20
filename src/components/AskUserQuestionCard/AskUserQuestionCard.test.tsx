import { render, screen, fireEvent, act } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import { AskUserQuestionCard, type AskInput } from './index'

const singleSelect: AskInput = {
  questions: [
    {
      question: '어떤 프레임워크 학습?',
      header: 'Framework',
      multiSelect: false,
      options: [
        { label: 'Next.js', description: 'App Router 학습' },
        { label: 'Remix', description: 'Loader/Action 패턴' },
      ],
    },
  ],
}

describe('AskUserQuestionCard', () => {
  it('질문과 옵션을 표시', () => {
    render(<AskUserQuestionCard input={singleSelect} onRespond={() => {}} />)
    expect(screen.getByText('어떤 프레임워크 학습?')).toBeInTheDocument()
    expect(screen.getByText('Next.js')).toBeInTheDocument()
    expect(screen.getByText('Remix')).toBeInTheDocument()
  })

  it('선택 안 하면 답변 전송 비활성', () => {
    render(<AskUserQuestionCard input={singleSelect} onRespond={() => {}} />)
    expect(screen.getByRole('button', { name: '답변 전송' })).toBeDisabled()
  })

  it('마지막 질문은 옵션 클릭 시 자동 전송되지 않고 명시적 전송 필요', () => {
    vi.useFakeTimers()
    const onRespond = vi.fn()
    render(<AskUserQuestionCard input={singleSelect} onRespond={onRespond} />)
    fireEvent.click(screen.getByText('Next.js'))
    act(() => {
      vi.advanceTimersByTime(500)
    })
    expect(onRespond).not.toHaveBeenCalled()
    // Submit button is now active and the user must click it themselves.
    const submitBtn = screen.getByRole('button', { name: '답변 전송' })
    expect(submitBtn).not.toBeDisabled()
    fireEvent.click(submitBtn)
    expect(onRespond).toHaveBeenCalledTimes(1)
    const [allow, updated] = onRespond.mock.calls[0]
    expect(allow).toBe(true)
    expect((updated as { answers: Record<string, string> }).answers).toEqual({
      '어떤 프레임워크 학습?': 'Next.js',
    })
    vi.useRealTimers()
  })

  it('중간 단일선택 질문은 자동으로 다음 질문으로 이동하되 마지막은 전송 안 함', () => {
    vi.useFakeTimers()
    const onRespond = vi.fn()
    const input: AskInput = {
      questions: [
        {
          question: 'Q1?',
          header: 'Q1',
          multiSelect: false,
          options: [{ label: 'A' }, { label: 'B' }],
        },
        {
          question: 'Q2?',
          header: 'Q2',
          multiSelect: false,
          options: [{ label: 'X' }, { label: 'Y' }],
        },
      ],
    }
    render(<AskUserQuestionCard input={input} onRespond={onRespond} />)
    expect(screen.getByText('Q1?')).toBeInTheDocument()
    fireEvent.click(screen.getByText('A'))
    act(() => {
      vi.advanceTimersByTime(300)
    })
    // Moved to Q2 automatically.
    expect(screen.getByText('Q2?')).toBeInTheDocument()
    expect(onRespond).not.toHaveBeenCalled()
    // Clicking the final answer should NOT submit on its own.
    fireEvent.click(screen.getByText('X'))
    act(() => {
      vi.advanceTimersByTime(500)
    })
    expect(onRespond).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: '답변 전송' }))
    expect(onRespond).toHaveBeenCalledTimes(1)
    const [, updated] = onRespond.mock.calls[0]
    expect((updated as { answers: Record<string, string> }).answers).toEqual({
      'Q1?': 'A',
      'Q2?': 'X',
    })
    vi.useRealTimers()
  })

  it('multiSelect=true는 여러 옵션을 CSV로 묶어 보냄', () => {
    const onRespond = vi.fn()
    const input: AskInput = {
      questions: [
        {
          question: '관심사?',
          multiSelect: true,
          options: [{ label: 'A' }, { label: 'B' }, { label: 'C' }],
        },
      ],
    }
    render(<AskUserQuestionCard input={input} onRespond={onRespond} />)
    fireEvent.click(screen.getByText('A'))
    fireEvent.click(screen.getByText('C'))
    fireEvent.click(screen.getByRole('button', { name: '답변 전송' }))
    const [, updated] = onRespond.mock.calls[0]
    expect((updated as { answers: Record<string, string> }).answers['관심사?']).toBe(
      'A, C',
    )
  })

  it('Other 선택 + 입력 시 입력 텍스트가 answer로 대체됨 (자동 진행 안 함)', () => {
    const onRespond = vi.fn()
    render(<AskUserQuestionCard input={singleSelect} onRespond={onRespond} />)
    fireEvent.click(screen.getByText('Other'))
    fireEvent.change(screen.getByPlaceholderText('직접 입력 후 Enter…'), {
      target: { value: 'SvelteKit' },
    })
    fireEvent.click(screen.getByRole('button', { name: '답변 전송' }))
    const [, updated] = onRespond.mock.calls[0]
    expect((updated as { answers: Record<string, string> }).answers).toEqual({
      '어떤 프레임워크 학습?': 'SvelteKit',
    })
  })

  it('숫자 키로 옵션 선택 + Enter로 전송', () => {
    const onRespond = vi.fn()
    render(<AskUserQuestionCard input={singleSelect} onRespond={onRespond} />)
    const card = screen.getByRole('region', { name: '질문 응답' })
    fireEvent.keyDown(card, { key: '2' })
    expect(screen.getByText('Remix').closest('.ask-question-card__option')).toHaveClass(
      'is-selected',
    )
    fireEvent.keyDown(card, { key: 'Enter' })
    expect(onRespond).toHaveBeenCalledTimes(1)
    const [, updated] = onRespond.mock.calls[0]
    expect((updated as { answers: Record<string, string> }).answers).toEqual({
      '어떤 프레임워크 학습?': 'Remix',
    })
  })

  it('Esc 키는 건너뛰기와 동일하게 처리', () => {
    const onRespond = vi.fn()
    render(<AskUserQuestionCard input={singleSelect} onRespond={onRespond} />)
    const card = screen.getByRole('region', { name: '질문 응답' })
    fireEvent.keyDown(card, { key: 'Escape' })
    expect(onRespond).toHaveBeenCalledWith(false, null)
  })

  it('건너뛰기 클릭 시 onRespond(false, null)', () => {
    const onRespond = vi.fn()
    render(<AskUserQuestionCard input={singleSelect} onRespond={onRespond} />)
    fireEvent.click(screen.getByRole('button', { name: '건너뛰기' }))
    expect(onRespond).toHaveBeenCalledWith(false, null)
  })
})
