interface Props {
  active: number
  total: number
  isLast: boolean
  everyAnswered: boolean
  currentAnswered: boolean
  onSkip: () => void
  onSubmit: () => void
  onNext: () => void
}

/**
 * 카드 하단: 진행 카운터 + 건너뛰기 + 답변 전송/다음 버튼. 마지막
 * 질문일 때는 전체 응답 여부에 따라 '답변 전송'을 토글하고, 그 외에는
 * 현재 질문 응답 여부에 따라 '다음 →'을 토글한다.
 */
export function CardFooter({
  active,
  total,
  isLast,
  everyAnswered,
  currentAnswered,
  onSkip,
  onSubmit,
  onNext,
}: Props) {
  return (
    <div className="ask-question-card__footer">
      {total > 1 && (
        <span className="ask-question-card__counter">
          {active + 1} / {total}
        </span>
      )}
      <button type="button" className="ask-question-card__skip" onClick={onSkip}>
        건너뛰기
      </button>
      {isLast ? (
        <button
          type="button"
          className="ask-question-card__submit"
          onClick={onSubmit}
          disabled={!everyAnswered}
        >
          답변 전송
        </button>
      ) : (
        <button
          type="button"
          className="ask-question-card__submit"
          onClick={onNext}
          disabled={!currentAnswered}
        >
          다음 →
        </button>
      )}
    </div>
  )
}
