import type { AskQuestion } from './index'
import type { AnswersState } from './useAskAnswers'

interface Props {
  questions: AskQuestion[]
  active: number
  answers: AnswersState
  onGoTo: (index: number) => void
}

/**
 * 질문이 둘 이상일 때 카드 상단에 표시되는 질문 탭 행. 응답된 질문에는
 * ✓가 붙고, 활성 탭은 is-active로 강조. 클릭하면 onGoTo(i).
 */
export function QuestionNav({ questions, active, answers, onGoTo }: Props) {
  if (questions.length <= 1) return null
  return (
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
            onClick={() => onGoTo(i)}
          >
            {qq.header || `Q${i + 1}`}
            {answered && <span className="ask-question-card__check">✓</span>}
          </button>
        )
      })}
    </header>
  )
}
