import type { Source } from '../../types/task'
import { sourceTitle } from '../../utils/sourceTitle'

interface Props {
  sources: Source[]
  onDelete: (sourceId: string) => void
  formatTimestamp: (ms: number) => string
  /** Open the source's full content in the shared file viewer (rendered md). */
  onOpen?: (source: Source) => void
}

/** Sources list panel inside TaskDetail — captured snippets per task. */
export function SourcesSection({ sources, onDelete, formatTimestamp, onOpen }: Props) {
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
              onOpen={onOpen}
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
  onOpen,
}: {
  source: Source
  onDelete: (sourceId: string) => void
  formatTimestamp: (ms: number) => string
  onOpen?: (source: Source) => void
}) {
  const isProcessed = !!source.processed_at_ms
  return (
    <li
      className={
        'task-detail__source-item' + (isProcessed ? ' is-processed' : '')
      }
    >
      <div className="task-detail__source-meta">
        {onOpen ? (
          <button
            type="button"
            className="task-detail__source-title-btn"
            onClick={() => onOpen(source)}
            title="파일뷰로 열기"
          >
            📄 {sourceTitle(source)}
          </button>
        ) : (
          <span className="task-detail__source-title">
            {sourceTitle(source)}
          </span>
        )}
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
      <div className="task-detail__source-submeta">
        {source.kind} · {formatTimestamp(source.captured_at_ms)}
        {isProcessed ? (
          <span className="task-detail__source-badge--ok">✓ wiki 반영됨</span>
        ) : (
          <span className="task-detail__source-badge--pending">● 미정리</span>
        )}
      </div>
    </li>
  )
}
