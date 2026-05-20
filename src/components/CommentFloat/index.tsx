import { useEffect, useState } from 'react'
import type { SelectionState } from '../../types'
import { Icon } from '../Icon'
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
  onPin?: (text: string) => Promise<void> | void
}

export function CommentFloat({ selection, onClose, onAddComment, onPin }: Props) {
  const [pinned, setPinned] = useState(false)

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

  const handlePin = async () => {
    if (!onPin) return
    setPinned(true)
    await onPin(selection.text)
    // Keep the float open briefly so the user can read the "pinned" state,
    // then close so the next selection starts clean.
    setTimeout(onClose, 600)
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
        {onPin && (
          <button
            className="comment-float__button comment-float__button--pin"
            onClick={handlePin}
            disabled={pinned}
            title="이 선택을 프로젝트 핀으로 저장"
          >
            <Icon name="pin" />
            <span>{pinned ? '저장됨' : '핀'}</span>
          </button>
        )}
        {onAddComment && (
          <button
            className="comment-float__button"
            onClick={handleAddComment}
            title="선택 영역을 입력창에 코멘트로 추가"
          >
            <Icon name="comment" />
            <span>코멘트로 추가</span>
          </button>
        )}
      </div>
    </div>
  )
}
