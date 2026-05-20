import { useSelection } from '../../hooks/useSelection'
import { useStickyScroll } from '../../hooks/useStickyScroll'
import { CommentFloat } from '../CommentFloat'
import { SegmentView } from '../MessageBubble'
import { StatusIndicator, computeTurnIndicator } from '../StatusIndicator'
import { FilePath, type OpenFileFn } from '../ToolViews'
import type { AssistantSegment, QaPair, ToolRequest } from '../../types'
import type { TaskActivity } from '../../state/sessionStore'
import './ExpandPane.css'

interface Props {
  pair: QaPair | null
  isOpen: boolean
  onToggle: () => void
  onOpenFile?: OpenFileFn
  /**
   * Streaming status — when the agent loop is active, ExpandPane shows a
   * bottom progress strip (✴ + verb + dots) mirroring ChatStream's footer.
   * Computing visibility uses the *in-flight* pair (the tail of `pairs`),
   * not whatever the user currently has expanded.
   */
  pairs?: QaPair[]
  pendingTool?: ToolRequest | null
  turnInProgress?: boolean
  taskActivity?: TaskActivity | null
  hookActivity?: string | null
  /** Attach a selection to the composer as a `[코멘트 #N]` placeholder. */
  onAddComment?: (text: string) => void
}

function formatTime(iso: string): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

/** Same compact-step set as QaCard (file_path bearing tools). */
const FILE_PATH_TOOLS = new Set(['Read', 'Edit', 'Write', 'MultiEdit', 'NotebookEdit'])

function thinkingLabel(seg: Extract<AssistantSegment, { kind: 'thinking' }>): string {
  // Mirrors QaCard: drop the trailing "…" while partial, since the pulsing
  // dot triplet next to the label handles the "still working" cue.
  if (seg.partial) return 'Thinking'
  if (typeof seg.duration_ms === 'number') {
    return `Thought for ${Math.max(1, Math.round(seg.duration_ms / 1000))}s`
  }
  return 'Thinking'
}

export function ExpandPane({
  pair,
  isOpen,
  onToggle,
  onOpenFile,
  pairs,
  pendingTool,
  turnInProgress,
  taskActivity,
  hookActivity,
  onAddComment,
}: Props) {
  const { selection, handleMouseUp, clearSelection } = useSelection()
  // Re-pin to bottom whenever the active pair gains segments — but only
  // if the user is already at the bottom. Scrolling up to re-read older
  // content stays put.
  const { ref: bodyRef, onScroll } = useStickyScroll<HTMLDivElement>([
    pair?.id,
    pair?.segments.length ?? 0,
  ])

  if (!isOpen) {
    return null
  }

  return (
    <aside className="expand-pane" aria-expanded={true}>
      <header className="expand-pane__header">
        <button
          type="button"
          className="expand-pane__toggle"
          aria-label="펼쳐보기 패널 접기"
          onClick={onToggle}
        >
          ▶
        </button>
        <div className="expand-pane__title">
          {pair ? (
            <span className="expand-pane__time">{formatTime(pair.timestamp)}</span>
          ) : (
            <span className="expand-pane__title-empty">펼쳐보기</span>
          )}
        </div>
      </header>
      <div
        ref={bodyRef}
        className="expand-pane__body"
        onMouseUp={handleMouseUp}
        onScroll={onScroll}
      >
        {pair ? (
          <>
            <section className="expand-pane__question">
              <div className="expand-pane__question-label">질문</div>
              <div className="expand-pane__question-text">{pair.user_text}</div>
            </section>
            {pair.segments.length > 0 ? (
            // Same compact step layout as QaCard:
            //   thinking → "● Thought for Ns" (body ignored even if present)
            //   tool_use → "● **Name** arg" (file_path tools render arg as link)
            //   tool_result → hidden
            //   text / plan → full markdown (no preview truncation)
            //   image / redacted_thinking → SegmentView
            pair.segments.map((seg, i) => {
              if (seg.kind === 'tool_result') return null
              if (seg.kind === 'thinking') {
                return (
                  <div key={i} className="expand-pane__step">
                    <span className="expand-pane__step-dot" aria-hidden="true" />
                    <span className="expand-pane__step-label">{thinkingLabel(seg)}</span>
                  </div>
                )
              }
              if (seg.kind === 'tool_use') {
                const isFilePath = FILE_PATH_TOOLS.has(seg.name) && seg.summary
                return (
                  <div key={i} className="expand-pane__step">
                    <span className="expand-pane__step-dot" aria-hidden="true" />
                    <span className="expand-pane__step-tool">{seg.name}</span>
                    {isFilePath ? (
                      <FilePath
                        path={seg.summary}
                        onOpen={onOpenFile}
                        className="expand-pane__step-arg expand-pane__step-arg--link"
                      />
                    ) : (
                      seg.summary && (
                        <span className="expand-pane__step-arg">{seg.summary}</span>
                      )
                    )}
                  </div>
                )
              }
              return <SegmentView key={i} segment={seg} onOpenFile={onOpenFile} />
            })
          ) : (
            <div className="expand-pane__pending">답변 대기 중…</div>
          )}
          {selection.text && selection.rect && (
            <CommentFloat
              selection={{ text: selection.text, rect: selection.rect }}
              onClose={clearSelection}
              onAddComment={onAddComment}
            />
          )}
          </>
        ) : (
          <div className="expand-pane__placeholder">
            메인에서 '전체보기'를 눌러 답변을 펼쳐보세요
          </div>
        )}
        {(() => {
          // Streaming indicator footer — visibility/override come from the
          // session-level in-flight pair (tail of `pairs`), not the user's
          // currently-expanded pair. Lives outside the `pair` conditional so
          // it surfaces even when no card has been selected yet (right pane
          // just opened during streaming).
          if (!pairs || pairs.length === 0) return null
          const { show, override } = computeTurnIndicator(
            pairs,
            pendingTool ?? null,
            turnInProgress ?? false,
          )
          if (!show) return null
          return (
            <StatusIndicator
              override={override}
              taskActivity={taskActivity ?? null}
              hookActivity={hookActivity ?? null}
              className="status-indicator--inline"
            />
          )
        })()}
      </div>
    </aside>
  )
}
