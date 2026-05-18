import type { AssistantSegment, QaPair } from '../../types'
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

function previewText(text: string, max = 40): string {
  const oneLine = text.replace(/\s+/g, ' ').trim()
  if (oneLine.length <= max) return oneLine
  return oneLine.slice(0, max) + '…'
}

export function assistantPreview(segments: AssistantSegment[]): string {
  const visible = segments
    .map((s) => (s.kind === 'text' || s.kind === 'plan' ? s.text : ''))
    .filter(Boolean)
    .join(' ')
  return visible
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
        const previewBody = assistantPreview(pair.segments)
        return (
          <button
            key={pair.id}
            className={`message-list__item${isSelected ? ' message-list__item--active' : ''}`}
            onClick={() => onSelect(pair.id)}
          >
            <div className="message-list__time">{formatTime(pair.timestamp)}</div>
            <div className="message-list__q">Q. {previewText(pair.user_text)}</div>
            <div className="message-list__a">
              {previewBody
                ? `A. ${previewText(previewBody)}`
                : <span className="message-list__pending">A. 응답 대기 중…</span>}
            </div>
          </button>
        )
      })}
    </div>
  )
}
