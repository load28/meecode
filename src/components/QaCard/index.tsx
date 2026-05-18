import type { QaPair } from '../../types'
import { renderMarkdown, SegmentView } from '../MessageBubble'
import { makePreview } from '../../utils/segmentHelpers'
import { useSelection } from '../../hooks/useSelection'
import { CommentFloat } from '../CommentFloat'
import './QaCard.css'

interface Props {
  pair: QaPair
  onExpand: () => void
}

function combineTextPlan(segments: QaPair['segments']): string {
  return segments
    .filter((s) => s.kind === 'text' || s.kind === 'plan')
    .map((s) => (s as { text: string }).text)
    .join('\n\n')
}

export function QaCard({ pair, onExpand }: Props) {
  const { selection, handleMouseUp, clearSelection } = useSelection()
  const thinkingSegments = pair.segments.filter((s) => s.kind === 'thinking')
  const toolSegments = pair.segments.filter((s) => s.kind === 'tool_use')
  const hasAnyContent = pair.segments.length > 0

  return (
    <article className="qa-card">
      <button
        type="button"
        className="qa-card__expand-btn"
        aria-label="대화 전체보기"
        title="대화 전체보기"
        onClick={onExpand}
      >
        ⤢
      </button>
      <header className="qa-card__question">
        <span className="qa-card__question-label">Q</span>
        <span className="qa-card__question-text">{makePreview(pair.user_text)}</span>
      </header>

      {!hasAnyContent ? (
        <div className="qa-card__pending">응답 대기 중…</div>
      ) : (
        <div className="qa-card__answer" onMouseUp={handleMouseUp}>
          {thinkingSegments.length > 0 && (
            <div className="qa-card__thinking">
              {thinkingSegments.map((seg, i) => (
                <SegmentView key={`th-${i}`} segment={seg} />
              ))}
            </div>
          )}
          <div
            className="qa-card__preview"
            dangerouslySetInnerHTML={{
              __html: renderMarkdown(makePreview(combineTextPlan(pair.segments))),
            }}
          />
          {toolSegments.length > 0 && (
            <div className="qa-card__tools">
              {toolSegments.map((seg, i) => (
                <SegmentView key={i} segment={seg} />
              ))}
            </div>
          )}
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
