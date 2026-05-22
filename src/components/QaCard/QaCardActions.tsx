interface Props {
  onCapture: (() => void) | undefined
  onExpand: () => void
}

/** 카드 우상단의 작은 액션 버튼 행: 캡처(📥) / 전체보기(⤢). */
export function QaCardActions({ onCapture, onExpand }: Props) {
  return (
    <div className="qa-card__actions">
      {onCapture && (
        <button
          type="button"
          className="qa-card__capture-btn"
          aria-label="이 답변을 Task에 캡처"
          title="이 답변을 Task에 캡처"
          onClick={onCapture}
        >
          📥
        </button>
      )}
      <button
        type="button"
        className="qa-card__expand-btn"
        aria-label="대화 전체보기"
        title="대화 전체보기"
        onClick={onExpand}
      >
        ⤢
      </button>
    </div>
  )
}
