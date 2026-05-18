import { useSelection } from '../../hooks/useSelection'
import { CommentFloat } from '../CommentFloat'
import { SegmentView } from '../MessageBubble'
import type { QaPair } from '../../types'
import './ExpandPane.css'

interface Props {
  pair: QaPair | null
  isOpen: boolean
  onToggle: () => void
}

function formatTime(iso: string): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

export function ExpandPane({ pair, isOpen, onToggle }: Props) {
  const { selection, handleMouseUp, clearSelection } = useSelection()

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
      {pair ? (
        <div className="expand-pane__body" onMouseUp={handleMouseUp}>
          <section className="expand-pane__question">
            <div className="expand-pane__question-label">질문</div>
            <div className="expand-pane__question-text">{pair.user_text}</div>
          </section>
          {pair.segments.length > 0 ? (
            pair.segments.map((seg, i) => (
              <SegmentView key={i} segment={seg} />
            ))
          ) : (
            <div className="expand-pane__pending">답변 대기 중…</div>
          )}
          {selection.text && selection.rect && (
            <CommentFloat
              selection={{ text: selection.text, rect: selection.rect }}
              onClose={clearSelection}
            />
          )}
        </div>
      ) : (
        <div className="expand-pane__placeholder">
          메인에서 '전체보기'를 눌러 답변을 펼쳐보세요
        </div>
      )}
    </aside>
  )
}
