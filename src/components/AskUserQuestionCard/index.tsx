import { useState } from 'react'
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

interface AnswersState {
  [question: string]: { picks: Set<string>; otherText: string }
}

function blankAnswers(qs: AskQuestion[]): AnswersState {
  const out: AnswersState = {}
  for (const q of qs) out[q.question] = { picks: new Set(), otherText: '' }
  return out
}

function joinAnswer(state: { picks: Set<string>; otherText: string }): string {
  const arr = Array.from(state.picks)
  if (arr.includes('Other') && state.otherText.trim()) {
    const rest = arr.filter((x) => x !== 'Other')
    rest.push(state.otherText.trim())
    return rest.join(', ')
  }
  return arr.join(', ')
}

export function AskUserQuestionCard({ input, onRespond }: Props) {
  const questions = input.questions ?? []
  const [active, setActive] = useState(0)
  const [answers, setAnswers] = useState<AnswersState>(() => blankAnswers(questions))

  if (questions.length === 0) {
    return (
      <section className="ask-question-card" role="region" aria-label="질문 입력">
        <div className="ask-question-card__empty">질문이 비어 있다</div>
      </section>
    )
  }

  const q = questions[active]
  const state = answers[q.question] ?? { picks: new Set(), otherText: '' }

  const toggle = (label: string) => {
    setAnswers((prev) => {
      const next = { ...prev }
      const slot = { ...next[q.question], picks: new Set(next[q.question].picks) }
      if (q.multiSelect) {
        if (slot.picks.has(label)) slot.picks.delete(label)
        else slot.picks.add(label)
      } else {
        slot.picks = new Set([label])
      }
      next[q.question] = slot
      return next
    })
  }

  const setOther = (text: string) => {
    setAnswers((prev) => ({
      ...prev,
      [q.question]: { ...prev[q.question], otherText: text },
    }))
  }

  const submit = () => {
    const payloadAnswers: Record<string, string> = {}
    for (const qq of questions) {
      const s = answers[qq.question]
      if (s && s.picks.size > 0) {
        payloadAnswers[qq.question] = joinAnswer(s)
      }
    }
    onRespond(true, { questions, ...({ answers: payloadAnswers } as object) } as AskInput)
  }

  const skip = () => onRespond(false, null)

  const everyAnswered = questions.every(
    (qq) => (answers[qq.question]?.picks.size ?? 0) > 0,
  )

  return (
    <section className="ask-question-card" role="region" aria-label="질문 응답">
      <header className="ask-question-card__nav">
        {questions.map((qq, i) => {
          const answered = (answers[qq.question]?.picks.size ?? 0) > 0
          return (
            <button
              key={i}
              type="button"
              className={
                'ask-question-card__tab' +
                (i === active ? ' is-active' : '') +
                (answered ? ' is-answered' : '')
              }
              onClick={() => setActive(i)}
            >
              {qq.header || `Q${i + 1}`}
              {answered && <span className="ask-question-card__check">✓</span>}
            </button>
          )
        })}
      </header>

      <div className="ask-question-card__question">{q.question}</div>

      <div className="ask-question-card__options">
        {q.options.map((opt, i) => {
          const checked = state.picks.has(opt.label)
          return (
            <label
              key={i}
              className={
                'ask-question-card__option' + (checked ? ' is-selected' : '')
              }
            >
              <input
                type={q.multiSelect ? 'checkbox' : 'radio'}
                name={`q-${active}`}
                checked={checked}
                onChange={() => toggle(opt.label)}
              />
              <div className="ask-question-card__option-body">
                <div className="ask-question-card__option-label">{opt.label}</div>
                {opt.description && (
                  <div className="ask-question-card__option-desc">{opt.description}</div>
                )}
              </div>
            </label>
          )
        })}

        <label
          className={
            'ask-question-card__option' +
            (state.picks.has('Other') ? ' is-selected' : '')
          }
        >
          <input
            type={q.multiSelect ? 'checkbox' : 'radio'}
            name={`q-${active}`}
            checked={state.picks.has('Other')}
            onChange={() => toggle('Other')}
          />
          <div className="ask-question-card__option-body">
            <div className="ask-question-card__option-label">Other</div>
            {state.picks.has('Other') && (
              <input
                type="text"
                className="ask-question-card__other-input"
                placeholder="직접 입력…"
                value={state.otherText}
                onChange={(e) => setOther(e.target.value)}
                autoFocus
              />
            )}
          </div>
        </label>
      </div>

      <div className="ask-question-card__footer">
        {questions.length > 1 && (
          <span className="ask-question-card__counter">
            {active + 1} / {questions.length}
          </span>
        )}
        <button
          type="button"
          className="ask-question-card__skip"
          onClick={skip}
        >
          건너뛰기
        </button>
        <button
          type="button"
          className="ask-question-card__submit"
          onClick={submit}
          disabled={!everyAnswered}
        >
          답변 전송
        </button>
      </div>
    </section>
  )
}
