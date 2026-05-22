import { useRef } from 'react'
import { QuestionOptions } from './QuestionOptions'
import { useAskAnswers } from './useAskAnswers'
import './AskUserQuestionCard.css'

export interface AskOption {
  label: string
  description?: string
}

export interface AskQuestion {
  question: string
  header?: string
  multiSelect?: boolean
  options: AskOption[]
}

export interface AskInput {
  questions: AskQuestion[]
}

interface Props {
  input: AskInput
  onRespond: (allow: boolean, updatedInput: AskInput | null) => void
}

export function AskUserQuestionCard({ input, onRespond }: Props) {
  const questions = input.questions ?? []
  const containerRef = useRef<HTMLElement | null>(null)
  const ans = useAskAnswers(questions)

  if (questions.length === 0) {
    return (
      <section className="ask-question-card" role="region" aria-label="질문 입력">
        <div className="ask-question-card__empty">질문이 비어 있다</div>
      </section>
    )
  }

  const q = questions[ans.active]

  const submit = () => {
    onRespond(true, {
      questions,
      ...({ answers: ans.buildPayload() } as object),
    } as AskInput)
  }

  const skip = () => {
    onRespond(false, null)
  }

  // Plugin-style keyboard nav: digits 1-9 pick the corresponding option,
  // Enter advances (or submits on the final question). Listening on the card
  // root rather than window so we don't fight other inputs.
  const handleKeyDown = (e: React.KeyboardEvent<HTMLElement>) => {
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) {
      return
    }
    if (e.key >= '1' && e.key <= '9') {
      const idx = Number(e.key) - 1
      const total = q.options.length + 1 // +1 for the trailing "Other" row
      if (idx >= 0 && idx < total) {
        e.preventDefault()
        const label = idx < q.options.length ? q.options[idx].label : 'Other'
        ans.toggle(label)
      }
      return
    }
    if (e.key === 'Enter') {
      e.preventDefault()
      if (ans.isLast && ans.everyAnswered) submit()
      else if (!ans.isLast && ans.currentAnswered) ans.goNext()
    } else if (e.key === 'Escape') {
      e.preventDefault()
      skip()
    }
  }

  return (
    <section
      ref={containerRef}
      className="ask-question-card"
      role="region"
      aria-label="질문 응답"
      tabIndex={-1}
      onKeyDown={handleKeyDown}
    >
      {questions.length > 1 && (
        <header className="ask-question-card__nav">
          {questions.map((qq, i) => {
            const answered = (ans.answers[qq.question]?.picks.size ?? 0) > 0
            return (
              <button
                key={i}
                type="button"
                className={
                  'ask-question-card__tab' +
                  (i === ans.active ? ' is-active' : '') +
                  (answered ? ' is-answered' : '')
                }
                onClick={() => ans.goTo(i)}
              >
                {qq.header || `Q${i + 1}`}
                {answered && <span className="ask-question-card__check">✓</span>}
              </button>
            )
          })}
        </header>
      )}

      <div className="ask-question-card__question">{q.question}</div>

      <QuestionOptions
        question={q}
        activeIndex={ans.active}
        picks={ans.current.picks}
        otherText={ans.current.otherText}
        onToggle={ans.toggle}
        onOtherChange={ans.setOther}
        onOtherEnter={() => (ans.isLast ? submit() : ans.goNext())}
      />

      <div className="ask-question-card__hint" aria-hidden="true">
        숫자 키로 선택 · Enter로 {ans.isLast ? '전송' : '다음'} · Esc로 건너뛰기
      </div>

      <div className="ask-question-card__footer">
        {questions.length > 1 && (
          <span className="ask-question-card__counter">
            {ans.active + 1} / {questions.length}
          </span>
        )}
        <button
          type="button"
          className="ask-question-card__skip"
          onClick={skip}
        >
          건너뛰기
        </button>
        {ans.isLast ? (
          <button
            type="button"
            className="ask-question-card__submit"
            onClick={submit}
            disabled={!ans.everyAnswered}
          >
            답변 전송
          </button>
        ) : (
          <button
            type="button"
            className="ask-question-card__submit"
            onClick={() => ans.goNext()}
            disabled={!ans.currentAnswered}
          >
            다음 →
          </button>
        )}
      </div>
    </section>
  )
}
