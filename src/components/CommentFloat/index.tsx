import { useState, useEffect } from 'react'
import { invoke } from '@tauri-apps/api/core'
import type { SelectionState } from '../../types'
import './CommentFloat.css'

interface Props {
  selection: SelectionState & { rect: DOMRect }
  onClose: () => void
  onPin?: (text: string) => Promise<void> | void
}

export function CommentFloat({ selection, onClose, onPin }: Props) {
  const [showInput, setShowInput] = useState(false)
  const [input, setInput] = useState('')
  const [pinned, setPinned] = useState(false)

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [onClose])

  const handleSubmit = async () => {
    if (!input.trim()) return
    const message = `[선택: "${selection.text}"] ${input.trim()}`
    await invoke('send_user_message', { text: message })
    setInput('')
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
      {!showInput ? (
        <div className="comment-float__actions">
          {onPin && (
            <button
              className="comment-float__button comment-float__button--pin"
              onClick={handlePin}
              disabled={pinned}
              title="이 선택을 프로젝트 핀으로 저장"
            >
              {pinned ? '📌 저장됨' : '📌 핀'}
            </button>
          )}
          <button
            className="comment-float__button"
            onClick={() => setShowInput(true)}
          >
            💬 코멘트
          </button>
        </div>
      ) : (
        <div className="comment-float__input-row">
          <input
            autoFocus
            className="comment-float__input"
            placeholder="질문을 입력하세요..."
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleSubmit()}
          />
          <button className="comment-float__send" onClick={handleSubmit}>
            전송
          </button>
        </div>
      )}
    </div>
  )
}
