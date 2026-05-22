import { useEffect, useRef, useState } from 'react'
import type { QaPair } from '../../types'
import { renderMarkdown, SegmentView } from '../MessageBubble'
import { FilePath, type OpenFileFn } from '../ToolViews'
import { makePreview } from '../../utils/segmentHelpers'
import { useSelection } from '../../hooks/useSelection'
import { CommentFloat } from '../CommentFloat'
import {
  ANSWER_MAX_HEIGHT_PX,
  FILE_PATH_TOOLS,
  buildPairText,
  pendingFromSegment,
  thinkingLabel,
} from './helpers'
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

  // Collapse-by-height: the answer body is clamped to ANSWER_MAX_HEIGHT_PX
  // by default and unfolds when the user opts in. `overflowing` is computed
  // from the actual rendered height so the toggle button (and bottom fade)
  // only appears when there's something hidden — a short response stays
  // clean with no extra chrome.
  const [expanded, setExpanded] = useState(false)
  const [overflowing, setOverflowing] = useState(false)
  const answerRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    const el = answerRef.current
    if (!el) {
      setOverflowing(false)
      return
    }
    const check = () => {
      // Compare full content height against the rendered (clamped) height.
      // +1 absorbs sub-pixel rounding so a card with exactly the max height
      // doesn't flicker the toggle in and out.
      setOverflowing(el.scrollHeight > el.clientHeight + 1)
    }
    check()
    const ro = new ResizeObserver(check)
    ro.observe(el)
    return () => ro.disconnect()
  }, [pair.segments])

  const answerCls = expanded
    ? 'qa-card__answer qa-card__answer--expanded'
    : overflowing
    ? 'qa-card__answer qa-card__answer--clamped'
    : 'qa-card__answer'

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
      <div className="qa-card__actions">
        {onCapture && (
          <button
            type="button"
            className="qa-card__capture-btn"
            aria-label="이 답변을 Task에 캡처"
            title="이 답변을 Task에 캡처"
            onClick={handleCardCapture}
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
      <header className="qa-card__question">
        <span className="qa-card__question-label">Q</span>
        <span className="qa-card__question-text">{makePreview(pair.user_text)}</span>
        {pair.interrupted && (
          <span className="qa-card__interrupted-badge" title="사용자에 의해 응답이 중단됨">
            중단됨
          </span>
        )}
      </header>

      {!hasAnyContent ? (
        <div className="qa-card__pending">응답 대기 중…</div>
      ) : (
        <>
          <div
            ref={answerRef}
            className={answerCls}
            style={
              expanded ? undefined : { maxHeight: `${ANSWER_MAX_HEIGHT_PX}px` }
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
                return (
                  <div key={i} className="qa-card__step">
                    <span className="qa-card__step-dot" aria-hidden="true" />
                    <span className="qa-card__step-label">{thinkingLabel(seg)}</span>
                  </div>
                )
              }
              if (seg.kind === 'tool_use') {
                const isFilePath = FILE_PATH_TOOLS.has(seg.name) && seg.summary
                // For Edit/Write/MultiEdit, ferry the proposed change along
                // with the open call so the FilePanel can default to a diff
                // view (Cursor-IDE style) instead of just showing the
                // current on-disk contents.
                const pending = isFilePath ? pendingFromSegment(seg) : null
                const handleOpen = (p: string) => {
                  onOpenFile?.(p, pending ? { pending } : undefined)
                }
                return (
                  <div key={i} className="qa-card__step">
                    <span className="qa-card__step-dot" aria-hidden="true" />
                    <span className="qa-card__step-tool">{seg.name}</span>
                    {isFilePath ? (
                      <FilePath
                        path={seg.summary}
                        onOpen={onOpenFile ? handleOpen : undefined}
                        className="qa-card__step-arg qa-card__step-arg--link"
                      />
                    ) : (
                      seg.summary && (
                        <span className="qa-card__step-arg">{seg.summary}</span>
                      )
                    )}
                  </div>
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
          {(overflowing || expanded) && (
            <button
              type="button"
              className="qa-card__toggle"
              onClick={() => setExpanded((v) => !v)}
              aria-expanded={expanded}
            >
              {expanded ? '접기 ↑' : '더 보기 ↓'}
            </button>
          )}
        </>
      )}
    </article>
  )
}
