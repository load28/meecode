import type { QaPair } from '../../types'
import { renderMarkdown, SegmentView } from '../MessageBubble'
import { type OpenFileFn } from '../ToolViews'
import { makePreview } from '../../utils/segmentHelpers'
import { useSelection } from '../../hooks/useSelection'
import { CommentFloat } from '../CommentFloat'
import { ANSWER_MAX_HEIGHT_PX, buildPairText } from './helpers'
import { ThinkingStep, ToolUseStep } from './StepRow'
import { useClampedAnswer } from './useClampedAnswer'
import { QaCardActions } from './QaCardActions'
import { QaCardHeader } from './QaCardHeader'
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
  onCapture?: (input: {
    kind: 'qa_block' | 'selection'
    content: string
    qaId: string
  }) => void
}

export function QaCard({ pair, onExpand, onOpenFile, onAddComment, onCapture }: Props) {
  const { selection, handleMouseUp, clearSelection } = useSelection()
  const hasAnyContent = pair.segments.length > 0

  // 답변 본체를 ANSWER_MAX_HEIGHT_PX로 잘라두고 사용자가 "더 보기"로
  // 펼치게 한다. 실제 콘텐츠가 그 높이를 초과할 때만 토글이 노출돼,
  // 짧은 응답은 추가 chrome 없이 그대로 보인다.
  const clamp = useClampedAnswer<HTMLDivElement>(pair.segments)

  const handleCardCapture = () => {
    if (!onCapture) return
    onCapture({ kind: 'qa_block', content: buildPairText(pair), qaId: pair.id })
  }

  const handleSelectionCapture = onCapture
    ? (text: string) => {
        onCapture({ kind: 'selection', content: text, qaId: pair.id })
      }
    : undefined

  return (
    <article className="qa-card">
      <QaCardActions
        onCapture={onCapture ? handleCardCapture : undefined}
        onExpand={onExpand}
      />
      <QaCardHeader text={pair.user_text} interrupted={!!pair.interrupted} />

      {!hasAnyContent ? (
        <div className="qa-card__pending">응답 대기 중…</div>
      ) : (
        <>
          <div
            ref={clamp.ref}
            className={clamp.className}
            style={
              clamp.expanded
                ? undefined
                : { maxHeight: `${ANSWER_MAX_HEIGHT_PX}px` }
            }
            onMouseUp={handleMouseUp}
          >
            {/*
              Compact step list, matching VS Code Claude plugin layout:
                - thinking → "● Thought for Ns" one-liner (no body)
                - tool_use → "● **Name** brief-arg" one-liner
                - tool_result → hidden inline; full output stays in ExpandPane
                - text / plan → markdown preview (truncated by makePreview)
                - image / redacted_thinking → SegmentView as-is
              Full segment renderings still live in ExpandPane via "전체보기".
            */}
            {pair.segments.map((seg, i) => {
              if (seg.kind === 'tool_result') return null
              if (seg.kind === 'interrupted') {
                return (
                  <div key={i} className="qa-card__interrupted" role="note">
                    <span aria-hidden="true">⛔</span>
                    <span>사용자에 의해 응답이 중단됨</span>
                  </div>
                )
              }
              if (seg.kind === 'thinking') {
                return <ThinkingStep key={i} segment={seg} />
              }
              if (seg.kind === 'tool_use') {
                return (
                  <ToolUseStep
                    key={i}
                    segment={seg}
                    onOpenFile={onOpenFile}
                  />
                )
              }
              if (seg.kind === 'text' || seg.kind === 'plan') {
                return (
                  <div
                    key={i}
                    // `message-bubble__content` opts the rendered markdown into
                    // the shared list/blockquote/spacing rules; without it the
                    // global `* { padding: 0 }` strips list indents.
                    className="qa-card__preview message-bubble__content"
                    dangerouslySetInnerHTML={{
                      __html: renderMarkdown(makePreview(seg.text)),
                    }}
                  />
                )
              }
              // image, redacted_thinking — unchanged
              return <SegmentView key={i} segment={seg} onOpenFile={onOpenFile} />
            })}
            {selection.text && selection.rect && (
              <CommentFloat
                selection={{ text: selection.text, rect: selection.rect }}
                onClose={clearSelection}
                onAddComment={onAddComment}
                onCapture={handleSelectionCapture}
              />
            )}
          </div>
          {(clamp.overflowing || clamp.expanded) && (
            <button
              type="button"
              className="qa-card__toggle"
              onClick={clamp.toggle}
              aria-expanded={clamp.expanded}
            >
              {clamp.expanded ? '접기 ↑' : '더 보기 ↓'}
            </button>
          )}
        </>
      )}
    </article>
  )
}
