import { useRef } from 'react'
import { QuestionOptions } from './QuestionOptions'
import { QuestionNav } from './QuestionNav'
import { CardFooter } from './CardFooter'
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
      <QuestionNav
        questions={questions}
        active={ans.active}
        answers={ans.answers}
        onGoTo={ans.goTo}
      />

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

      <CardFooter
        active={ans.active}
        total={questions.length}
        isLast={ans.isLast}
        everyAnswered={ans.everyAnswered}
        currentAnswered={ans.currentAnswered}
        onSkip={skip}
        onSubmit={submit}
        onNext={ans.goNext}
      />
    </section>
  )
}
