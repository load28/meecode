import { useEffect } from 'react'
import type { SelectionState } from '../../types'
import './CommentFloat.css'

interface Props {
  selection: SelectionState & { rect: DOMRect }
  onClose: () => void
  /**
   * Attach the selection to the composer as an inline-abbreviated
   * `[코멘트 #N +M줄]` placeholder. The user follows up with a freeform
   * question in the composer and submits the whole thing at once. This
   * replaces the previous immediate-submit `[선택: "..."]` flow so multiple
   * selections can be queued before sending.
   */
  onAddComment?: (text: string) => void
  /** Open the Task picker with this selection as the source content. */
  onCapture?: (text: string) => void
}

export function CommentFloat({ selection, onClose, onAddComment, onCapture }: Props) {
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [onClose])

  const handleAddComment = () => {
    if (!onAddComment) return
    onAddComment(selection.text)
    // Drop the native browser selection so a fresh click doesn't re-trigger
    // the float on the same range.
    window.getSelection()?.removeAllRanges()
    onClose()
  }

  const handleCapture = () => {
    if (!onCapture) return
    onCapture(selection.text)
    window.getSelection()?.removeAllRanges()
    onClose()
  }

  const style: React.CSSProperties = {
    position: 'fixed',
    top: selection.rect.top - 44,
    left: selection.rect.left,
    zIndex: 1000,
  }

  return (
    <div style={style} className="comment-float">
      <div className="comment-float__actions">
        {onCapture && (
          <button
            type="button"
            className="comment-float__button comment-float__button--capture"
            onClick={handleCapture}
            title="이 선택을 Task에 캡처"
          >
            📥 캡처
          </button>
        )}
        {onAddComment && (
          <button
            type="button"
            className="comment-float__button"
            onClick={handleAddComment}
            title="선택 영역을 입력창에 코멘트로 추가"
          >
            💬 코멘트로 추가
          </button>
        )}
      </div>
    </div>
  )
}
