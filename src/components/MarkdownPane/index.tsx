import { useMemo } from 'react'
import { marked } from 'marked'
import DOMPurify from 'dompurify'
import { useSelection } from '../../hooks/useSelection'
import { CommentFloat } from '../CommentFloat'
import { MessageList } from '../MessageList'
import type { QaPair } from '../../types'
import './MarkdownPane.css'

interface Props {
  pairs: QaPair[]
  selectedId: string | null
  onSelect: (id: string) => void
  isVisible: boolean
}

export function MarkdownPane({ pairs, selectedId, onSelect, isVisible }: Props) {
  const { selection, handleMouseUp, clearSelection } = useSelection()

  const selected = useMemo(
    () => pairs.find((p) => p.id === selectedId) ?? null,
    [pairs, selectedId]
  )

  const html = useMemo(() => {
    if (!selected || !selected.assistant_text) return ''
    const raw = marked.parse(selected.assistant_text, { async: false }) as string
    return DOMPurify.sanitize(raw)
  }, [selected])

  return (
    <div
      className="markdown-pane"
      style={{ display: isVisible ? 'flex' : 'none' }}
    >
      <div className="markdown-pane__sidebar">
        <MessageList pairs={pairs} selectedId={selectedId} onSelect={onSelect} />
      </div>
      <div className="markdown-pane__body" onMouseUp={handleMouseUp}>
        {selected ? (
          <>
            <div className="markdown-pane__question">
              <div className="markdown-pane__question-label">질문</div>
              <div className="markdown-pane__question-text">{selected.user_text}</div>
            </div>
            {selected.assistant_text ? (
              <div
                className="markdown-pane__content"
                dangerouslySetInnerHTML={{ __html: html }}
              />
            ) : (
              <div className="markdown-pane__pending">응답 대기 중…</div>
            )}
          </>
        ) : (
          <div className="markdown-pane__placeholder">좌측에서 항목을 선택하세요</div>
        )}
        {selection.text && selection.rect && (
          <CommentFloat
            selection={{ text: selection.text, rect: selection.rect }}
            onClose={clearSelection}
          />
        )}
      </div>
    </div>
  )
}
