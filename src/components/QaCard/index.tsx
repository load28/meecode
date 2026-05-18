import type { QaPair } from '../../types'
import { renderMarkdown, SegmentView } from '../MessageBubble'
import { totalTextChars, makePreview } from '../../utils/segmentHelpers'
import { useSelection } from '../../hooks/useSelection'
import { CommentFloat } from '../CommentFloat'
import './QaCard.css'

const FOLD_THRESHOLD = 500

interface Props {
  pair: QaPair
  isExpandedInPane: boolean
  onExpand: () => void
}

function combineTextPlan(segments: QaPair['segments']): string {
  return segments
    .filter((s) => s.kind === 'text' || s.kind === 'plan')
    .map((s) => (s as { text: string }).text)
    .join('\n\n')
}

export function QaCard({ pair, isExpandedInPane, onExpand }: Props) {
  const { selection, handleMouseUp, clearSelection } = useSelection()
  const totalChars = totalTextChars(pair.segments)
  const isFolded = totalChars > FOLD_THRESHOLD
  const toolSegments = pair.segments.filter((s) => s.kind === 'tool_use')
  const hasAnyContent = pair.segments.length > 0

  return (
    <article className="qa-card">
      <header className="qa-card__question">
        <span className="qa-card__question-label">Q</span>
        <span className="qa-card__question-text">{pair.user_text}</span>
      </header>

      {isExpandedInPane ? (
        <div className="qa-card__expanded-notice">오른쪽 패널에 펼쳐짐</div>
      ) : !hasAnyContent ? (
        <div className="qa-card__pending">응답 대기 중…</div>
      ) : isFolded ? (
        <div className="qa-card__answer qa-card__answer--folded">
          <div
            className="qa-card__preview"
            dangerouslySetInnerHTML={{
              __html: renderMarkdown(makePreview(combineTextPlan(pair.segments))),
            }}
          />
          <div className="qa-card__fade" aria-hidden="true" />
          {toolSegments.length > 0 && (
            <div className="qa-card__tools">
              {toolSegments.map((seg, i) => (
                <SegmentView key={i} segment={seg} />
              ))}
            </div>
          )}
          <button
            type="button"
            className="qa-card__expand-btn"
            aria-label="답변 전체보기"
            onClick={onExpand}
          >
            전체보기 →
          </button>
        </div>
      ) : (
        <div className="qa-card__answer" onMouseUp={handleMouseUp}>
          {pair.segments.map((seg, i) => (
            <SegmentView key={i} segment={seg} />
          ))}
          {selection.text && selection.rect && (
            <CommentFloat
              selection={{ text: selection.text, rect: selection.rect }}
              onClose={clearSelection}
            />
          )}
        </div>
      )}
    </article>
  )
}
