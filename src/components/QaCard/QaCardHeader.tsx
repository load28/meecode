import { makePreview } from '../../utils/segmentHelpers'

interface Props {
  text: string
  interrupted: boolean
}

/** "Q" 라벨 + 사용자 질문 미리보기 + 중단됨 배지 — qa-card 상단의 한 줄. */
export function QaCardHeader({ text, interrupted }: Props) {
  return (
    <header className="qa-card__question">
      <span className="qa-card__question-label">Q</span>
      <span className="qa-card__question-text">{makePreview(text)}</span>
      {interrupted && (
        <span
          className="qa-card__interrupted-badge"
          title="사용자에 의해 응답이 중단됨"
        >
          중단됨
        </span>
      )}
    </header>
  )
}
