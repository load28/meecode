import { makePreview } from '../../utils/segmentHelpers'
import { INTERRUPTED_BY_USER } from '../../utils/messages'

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
          title={INTERRUPTED_BY_USER}
        >
          중단됨
        </span>
      )}
    </header>
  )
}
