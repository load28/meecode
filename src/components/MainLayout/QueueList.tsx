import type { QueuedMessage } from '../../state/sessionStore'

interface Props {
  queue: QueuedMessage[]
  onRemove: (id: string) => void
}

/**
 * Composer가 turn-in-progress 동안 받은 메시지를 큐에 쌓아두는데, 그
 * 큐의 상단 노티 행을 렌더한다. 빈 큐일 때는 null을 반환.
 */
export function QueueList({ queue, onRemove }: Props) {
  if (queue.length === 0) return null
  return (
    <div className="app__queue">
      <div className="app__queue-label">⏳ 큐에 대기 중 ({queue.length})</div>
      {queue.map((q) => (
        <div key={q.id} className="app__queue-item">
          <span className="app__queue-text">{q.text || '🖼'}</span>
          <button
            type="button"
            className="app__queue-remove"
            onClick={() => onRemove(q.id)}
            title="큐에서 제거"
          >
            ×
          </button>
        </div>
      ))}
    </div>
  )
}
