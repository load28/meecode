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
          <span style={{ fontSize: 11 }}>
            채팅의 답변 옆 📥 버튼이나 선택 텍스트의 📥 캡처로 추가할 수 있습니다.
          </span>
        </div>
      ) : (
        <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
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
      style={{
        background: isProcessed ? '#0d1117' : '#10171f',
        border: isProcessed ? '1px solid #21262d' : '1px solid #1f3a5f',
        borderRadius: 6,
        padding: 8,
        marginBottom: 6,
        fontSize: 12,
        color: '#c9d1d9',
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          fontSize: 10,
          color: '#6e7681',
          marginBottom: 4,
        }}
      >
        <span style={{ flex: 1 }}>
          {source.kind} · {formatTimestamp(source.captured_at_ms)}
          {isProcessed ? (
            <span style={{ marginLeft: 6, color: '#79c0ff' }}>
              ✓ wiki 반영됨
            </span>
          ) : (
            <span style={{ marginLeft: 6, color: '#d29922' }}>● 미정리</span>
          )}
        </span>
        <button
          type="button"
          onClick={() => {
            if (confirm('이 Source를 삭제하시겠습니까?')) {
              onDelete(source.id)
            }
          }}
          style={{
            background: 'none',
            border: 'none',
            color: '#6e7681',
            cursor: 'pointer',
            fontSize: 14,
            padding: '0 4px',
          }}
          title="Source 삭제"
          aria-label="Source 삭제"
        >
          ×
        </button>
      </div>
      <div
        style={{
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-word',
          maxHeight: 120,
          overflow: 'hidden',
        }}
      >
        {source.content.slice(0, PREVIEW_MAX_CHARS)}
        {source.content.length > PREVIEW_MAX_CHARS ? '…' : ''}
      </div>
    </li>
  )
}
