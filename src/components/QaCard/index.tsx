import type { QaPair } from '../../types'
import type { CaptureSource } from '../../types/composer'
import { type OpenFileFn } from '../ToolViews'
import { useSelection } from '../../hooks/useSelection'
import { CommentFloat } from '../CommentFloat'
import { deriveTitle } from '../../utils/segmentHelpers'
import { parseTaskContextMessage } from '../../utils/taskContext'
import { TaskContextNote } from '../TaskContextNote'
import { CARD_MAX_HEIGHT_PX, buildPairText } from './helpers'
import { useClampedContent } from './useClampedContent'
import { QaCardActions } from './QaCardActions'
import { QaCardHeader } from './QaCardHeader'
import { QaSegmentView } from './QaSegmentView'
import './QaCard.css'

interface Props {
  pair: QaPair
  onExpand: () => void
  onOpenFile?: OpenFileFn
  /** Attach the active selection to the composer as a `[코멘트 #N]` token. */
  onAddComment?: (text: string) => void
  /**
   * Open the Task picker for a capture. `kind`/`content`/origin are gathered
   * here; the picker decides which Task receives the resulting Source.
   */
  onCapture?: (input: CaptureSource) => void
}

export function QaCard({ pair, onExpand, onOpenFile, onAddComment, onCapture }: Props) {
  const { selection, handleMouseUp, clearSelection } = useSelection()
  const hasAnyContent = pair.segments.length > 0

  // 카드 본문 전체(질문/Task 컨텍스트 + 답변)를 CARD_MAX_HEIGHT_PX로
  // 잘라두고 사용자가 "더 보기"로 펼치게 한다. 실제 콘텐츠가 그 높이를
  // 초과할 때만 토글이 노출돼, 짧은 카드는 추가 chrome 없이 그대로 보인다.
  const clamp = useClampedContent<HTMLDivElement, HTMLDivElement>(
    CARD_MAX_HEIGHT_PX,
  )

  const handleCardCapture = () => {
    if (!onCapture) return
    onCapture({
      kind: 'qa_block',
      content: buildPairText(pair),
      qaId: pair.id,
      suggestedTitle: deriveTitle(pair.user_text),
    })
  }

  const handleSelectionCapture = onCapture
    ? (text: string) => {
        onCapture({
          kind: 'selection',
          content: text,
          qaId: pair.id,
          suggestedTitle: deriveTitle(text),
        })
      }
    : undefined

  const taskContext = parseTaskContextMessage(pair.user_text)

  return (
    <article className="qa-card">
      <QaCardActions
        onCapture={onCapture ? handleCardCapture : undefined}
        onExpand={onExpand}
      />
      <div
        ref={clamp.outerRef}
        className={clamp.className}
        style={
          clamp.expanded ? undefined : { maxHeight: `${CARD_MAX_HEIGHT_PX}px` }
        }
      >
        <div ref={clamp.contentRef} className="qa-card__body-inner">
          {taskContext ? (
            <TaskContextNote text={pair.user_text} parsed={taskContext} />
          ) : (
            <QaCardHeader
              text={pair.user_text}
              interrupted={!!pair.interrupted}
            />
          )}

          {!hasAnyContent ? (
            <div className="qa-card__pending">응답 대기 중…</div>
          ) : (
            <div className="qa-card__answer" onMouseUp={handleMouseUp}>
              {pair.segments.map((seg, i) => (
                <QaSegmentView key={i} segment={seg} onOpenFile={onOpenFile} />
              ))}
              {selection.text && selection.rect && (
                <CommentFloat
                  selection={{ text: selection.text, rect: selection.rect }}
                  onClose={clearSelection}
                  onAddComment={onAddComment}
                  onCapture={handleSelectionCapture}
                />
              )}
            </div>
          )}
        </div>
      </div>
      {clamp.overflowing && (
        <button
          type="button"
          className="qa-card__toggle"
          onClick={clamp.toggle}
          aria-expanded={clamp.expanded}
        >
          {clamp.expanded ? '접기 ↑' : '더 보기 ↓'}
        </button>
      )}
    </article>
  )
}
