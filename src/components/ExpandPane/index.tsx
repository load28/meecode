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
    return (
      <div className="expand-pane expand-pane--collapsed">
        <button
          type="button"
          className="expand-pane__toggle"
          aria-label="펼쳐보기 패널 열기"
          aria-expanded={false}
          onClick={onToggle}
        >
          ◀
        </button>
      </div>
    )
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
            <>
              <span className="expand-pane__time">{formatTime(pair.timestamp)}</span>
              <span className="expand-pane__q" title={pair.user_text}>
                <span className="expand-pane__q-prefix">Q. </span>
                <span className="expand-pane__q-text">{pair.user_text}</span>
              </span>
            </>
          ) : (
            <span className="expand-pane__title-empty">펼쳐보기</span>
          )}
        </div>
      </header>
      {pair ? (
        <div className="expand-pane__body" onMouseUp={handleMouseUp}>
          {pair.segments.map((seg, i) => (
            <SegmentView key={i} segment={seg} />
          ))}
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
