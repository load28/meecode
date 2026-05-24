import { useSelection } from '../../hooks/useSelection'
import { useStickyScroll } from '../../hooks/useStickyScroll'
import { deriveTitle } from '../../utils/segmentHelpers'
import { parseTaskContextMessage } from '../../utils/taskContext'
import { TaskContextNote } from '../TaskContextNote'
import { CommentFloat } from '../CommentFloat'
import { type OpenFileFn } from '../ToolViews'
import type { QaPair, ToolRequest } from '../../types'
import type { CaptureSource } from '../../types/composer'
import type { TaskActivity } from '../../state/sessionStore'
import { ExpandPaneHeader } from './ExpandPaneHeader'
import { ExpandSegmentView } from './ExpandSegmentView'
import { StreamingIndicatorFooter } from './StreamingIndicatorFooter'
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
  /** Open the Task picker for a capture from the active QaPair. */
  onCapture?: (input: CaptureSource) => void
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
  onCapture,
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

  const taskContext = pair ? parseTaskContextMessage(pair.user_text) : null

  return (
    <aside className="expand-pane" aria-expanded={true}>
      <ExpandPaneHeader
        timestamp={pair?.timestamp ?? null}
        onToggle={onToggle}
      />
      <div
        ref={bodyRef}
        className="expand-pane__body"
        onMouseUp={handleMouseUp}
        onScroll={onScroll}
      >
        {pair ? (
          <>
            <section className="expand-pane__question">
              {taskContext ? (
                <TaskContextNote text={pair.user_text} parsed={taskContext} />
              ) : (
                <>
                  <div className="expand-pane__question-label">질문</div>
                  <div className="expand-pane__question-text">
                    {pair.user_text}
                  </div>
                </>
              )}
            </section>
            {pair.segments.length > 0 ? (
              pair.segments.map((seg, i) => (
                <ExpandSegmentView
                  key={i}
                  segment={seg}
                  onOpenFile={onOpenFile}
                />
              ))
            ) : (
              <div className="expand-pane__pending">답변 대기 중…</div>
            )}
          {selection.text && selection.rect && (
            <CommentFloat
              selection={{ text: selection.text, rect: selection.rect }}
              onClose={clearSelection}
              onAddComment={onAddComment}
              onCapture={
                onCapture && pair
                  ? (text) =>
                      onCapture({
                        kind: 'selection',
                        content: text,
                        qaId: pair.id,
                        suggestedTitle: deriveTitle(text),
                      })
                  : undefined
              }
            />
          )}
          </>
        ) : (
          <div className="expand-pane__placeholder">
            메인에서 '전체보기'를 눌러 답변을 펼쳐보세요
          </div>
        )}
        <StreamingIndicatorFooter
          pairs={pairs}
          pendingTool={pendingTool}
          turnInProgress={turnInProgress}
          taskActivity={taskActivity}
          hookActivity={hookActivity}
        />
      </div>
    </aside>
  )
}
