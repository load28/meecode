import type { Source } from '../../types/task'

const PREVIEW_MAX_CHARS = 400

interface Props {
  sources: Source[]
  onDelete: (sourceId: string) => void
  formatTimestamp: (ms: number) => string
}

/** Sources list panel inside TaskDetail — captured snippets per task. */
export function SourcesSection({ sources, onDelete, formatTimestamp }: Props) {
  return (
    <div className="task-detail__section">
      <h3 className="task-detail__section-title">Sources ({sources.length})</h3>
      {sources.length === 0 ? (
        <div className="task-detail__section-empty">
          아직 Source가 없습니다.
          <br />
          <span className="task-detail__section-empty-hint">
            채팅의 답변 옆 📥 버튼이나 선택 텍스트의 📥 캡처로 추가할 수 있습니다.
          </span>
        </div>
      ) : (
        <ul className="task-detail__source-list">
          {sources.map((s) => (
            <SourceRow
              key={s.id}
              source={s}
              onDelete={onDelete}
              formatTimestamp={formatTimestamp}
            />
          ))}
        </ul>
      )}
    </div>
  )
}

function SourceRow({
  source,
  onDelete,
  formatTimestamp,
}: {
  source: Source
  onDelete: (sourceId: string) => void
  formatTimestamp: (ms: number) => string
}) {
  const isProcessed = !!source.processed_at_ms
  return (
    <li
      className={
        'task-detail__source-item' + (isProcessed ? ' is-processed' : '')
      }
    >
      <div className="task-detail__source-meta">
        <span className="task-detail__source-meta-text">
          {source.kind} · {formatTimestamp(source.captured_at_ms)}
          {isProcessed ? (
            <span className="task-detail__source-badge--ok">✓ wiki 반영됨</span>
          ) : (
            <span className="task-detail__source-badge--pending">● 미정리</span>
          )}
        </span>
        <button
          type="button"
          onClick={() => {
            if (confirm('이 Source를 삭제하시겠습니까?')) {
              onDelete(source.id)
            }
          }}
          className="task-detail__source-delete"
          title="Source 삭제"
          aria-label="Source 삭제"
        >
          ×
        </button>
      </div>
      <div className="task-detail__source-body">
        {source.content.slice(0, PREVIEW_MAX_CHARS)}
        {source.content.length > PREVIEW_MAX_CHARS ? '…' : ''}
      </div>
    </li>
  )
}
