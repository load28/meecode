import type { QaPair } from '../../types'
import './MessageList.css'

interface Props {
  pairs: QaPair[]
  selectedId: string | null
  onSelect: (id: string) => void
}

function formatTime(iso: string): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const hh = String(d.getHours()).padStart(2, '0')
  const mm = String(d.getMinutes()).padStart(2, '0')
  return `${hh}:${mm}`
}

function preview(text: string, max = 40): string {
  const oneLine = text.replace(/\s+/g, ' ').trim()
  if (oneLine.length <= max) return oneLine
  return oneLine.slice(0, max) + '…'
}

export function MessageList({ pairs, selectedId, onSelect }: Props) {
  if (pairs.length === 0) {
    return (
      <div className="message-list message-list--empty">
        <span>아직 답변이 없습니다</span>
      </div>
    )
  }

  return (
    <div className="message-list">
      {pairs.map((pair) => {
        const isSelected = pair.id === selectedId
        return (
          <button
            key={pair.id}
            className={`message-list__item${isSelected ? ' message-list__item--active' : ''}`}
            onClick={() => onSelect(pair.id)}
          >
            <div className="message-list__time">{formatTime(pair.timestamp)}</div>
            <div className="message-list__q">Q. {preview(pair.user_text)}</div>
            <div className="message-list__a">
              {pair.assistant_text
                ? `A. ${preview(pair.assistant_text)}`
                : <span className="message-list__pending">A. 응답 대기 중…</span>}
            </div>
          </button>
        )
      })}
    </div>
  )
}
