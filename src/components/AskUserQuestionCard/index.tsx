import { useEffect, useRef, useState } from 'react'
import './AskUserQuestionCard.css'

// Single-select + non-"Other" picks auto-advance. The brief delay lets the
// user see the option highlight before the card swaps to the next question,
// so it doesn't feel like a click landed nowhere.
const AUTO_ADVANCE_MS = 220

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

  // Hold the auto-advance timer so a fast second click cancels the pending
  // navigation instead of jumping past the user's correction.
  const advanceTimer = useRef<number | null>(null)
  const clearAdvance = () => {
    if (advanceTimer.current !== null) {
      window.clearTimeout(advanceTimer.current)
      advanceTimer.current = null
    }
  }
  useEffect(() => clearAdvance, [])

  if (questions.length === 0) {
    return (
      <section className="ask-question-card" role="region" aria-label="질문 입력">
        <div className="ask-question-card__empty">질문이 비어 있다</div>
      </section>
    )
  }

  const q = questions[active]
  const state = answers[q.question] ?? { picks: new Set(), otherText: '' }
  const isLast = active === questions.length - 1

  const submitWith = (a: AnswersState) => {
    const payloadAnswers: Record<string, string> = {}
    for (const qq of questions) {
      const s = a[qq.question]
      if (s && s.picks.size > 0) {
        payloadAnswers[qq.question] = joinAnswer(s)
      }
    }
    onRespond(true, { questions, ...({ answers: payloadAnswers } as object) } as AskInput)
  }

  const submit = () => submitWith(answers)

  const advance = (snapshot: AnswersState) => {
    if (isLast) {
      submitWith(snapshot)
    } else {
      setActive(active + 1)
    }
  }

  const toggle = (label: string) => {
    clearAdvance()
    let nextAnswers!: AnswersState
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
      nextAnswers = next
      return next
    })

    // Auto-advance for single-select picks of concrete options. "Other"
    // expands an inline text field — auto-advancing would steal focus before
    // the user types, so it stays manual. Multi-select also stays manual
    // because there's no signal that the user is done picking.
    if (!q.multiSelect && label !== 'Other') {
      advanceTimer.current = window.setTimeout(() => {
        advanceTimer.current = null
        advance(nextAnswers)
      }, AUTO_ADVANCE_MS)
    }
  }

  const setOther = (text: string) => {
    setAnswers((prev) => ({
      ...prev,
      [q.question]: { ...prev[q.question], otherText: text },
    }))
  }

  const handleOtherKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && state.otherText.trim()) {
      e.preventDefault()
      advance(answers)
    }
  }

  const skip = () => {
    clearAdvance()
    onRespond(false, null)
  }

  const everyAnswered = questions.every(
    (qq) => (answers[qq.question]?.picks.size ?? 0) > 0,
  )
  const currentAnswered = (state.picks.size ?? 0) > 0

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
              onClick={() => {
                clearAdvance()
                setActive(i)
              }}
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
                placeholder="직접 입력 후 Enter…"
                value={state.otherText}
                onChange={(e) => setOther(e.target.value)}
                onKeyDown={handleOtherKey}
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
        {isLast ? (
          <button
            type="button"
            className="ask-question-card__submit"
            onClick={submit}
            disabled={!everyAnswered}
          >
            답변 전송
          </button>
        ) : (
          <button
            type="button"
            className="ask-question-card__submit"
            onClick={() => {
              clearAdvance()
              advance(answers)
            }}
            disabled={!currentAnswered}
          >
            다음 →
          </button>
        )}
      </div>
    </section>
  )
}
