import type { AssistantSegment, QaPair } from '../../types'
import { renderMarkdown, SegmentView } from '../MessageBubble'
import { FilePath } from '../ToolViews'
import { makePreview } from '../../utils/segmentHelpers'
import { useSelection } from '../../hooks/useSelection'
import { CommentFloat } from '../CommentFloat'
import './QaCard.css'

interface Props {
  pair: QaPair
  onExpand: () => void
  onOpenFile?: (path: string) => void
}

/** Tools whose `summary` (computed in `summarizeToolInput`) is a file path —
 *  these render as a clickable link instead of plain text in the step row. */
const FILE_PATH_TOOLS = new Set(['Read', 'Edit', 'Write', 'MultiEdit', 'NotebookEdit'])

function thinkingLabel(seg: Extract<AssistantSegment, { kind: 'thinking' }>): string {
  if (seg.partial) return 'Thinking…'
  if (typeof seg.duration_ms === 'number') {
    return `Thought for ${Math.max(1, Math.round(seg.duration_ms / 1000))}s`
  }
  return 'Thinking'
}

export function QaCard({ pair, onExpand, onOpenFile }: Props) {
  const { selection, handleMouseUp, clearSelection } = useSelection()
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
              return (
                <div key={i} className="qa-card__step">
                  <span className="qa-card__step-dot" aria-hidden="true" />
                  <span className="qa-card__step-tool">{seg.name}</span>
                  {isFilePath ? (
                    <FilePath
                      path={seg.summary}
                      onOpen={onOpenFile}
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
            />
          )}
        </div>
      )}
    </article>
  )
}
