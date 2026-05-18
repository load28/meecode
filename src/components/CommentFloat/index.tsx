import { useState, useEffect } from 'react'
import { invoke } from '@tauri-apps/api/core'
import type { SelectionState } from '../../types'
import './CommentFloat.css'

interface Props {
  selection: SelectionState & { rect: DOMRect }
  onClose: () => void
}

export function CommentFloat({ selection, onClose }: Props) {
  const [showInput, setShowInput] = useState(false)
  const [input, setInput] = useState('')

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [onClose])

  const handleSubmit = async () => {
    if (!input.trim()) return
    const message = `[선택: "${selection.text}"] ${input.trim()}\r`
    await invoke('write_input', { text: message })
    setInput('')
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
      {!showInput ? (
        <button
          className="comment-float__button"
          onClick={() => setShowInput(true)}
        >
          💬 코멘트
        </button>
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
