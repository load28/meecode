import { renderMarkdown } from '../MessageBubble'
import { LOADING } from '../../utils/messages'
import { useWikiBuffer } from './useWikiBuffer'
import './WikiEditor.css'

interface Props {
  taskId: string
  name: string
  onClose: () => void
  /** Returns the persisted body. Empty string if file doesn't exist yet. */
  readFile: (name: string) => Promise<string>
  writeFile: (name: string, content: string) => Promise<boolean>
  deleteFile: (name: string) => Promise<void>
}

export function WikiEditor({
  taskId,
  name,
  onClose,
  readFile,
  writeFile,
  deleteFile,
}: Props) {
  const buf = useWikiBuffer({
    taskId,
    name,
    readFile,
    writeFile,
    deleteFile,
    onDeleted: onClose,
  })

  return (
    <div className="wiki-editor">
      <div className="wiki-editor__header">
        <span className="wiki-editor__name">{name}</span>
        <div className="wiki-editor__mode" role="group" aria-label="모드 전환">
          <button
            type="button"
            className={`wiki-editor__mode-btn${
              buf.mode === 'read' ? ' is-active' : ''
            }`}
            onClick={() => buf.setMode('read')}
          >
            읽기
          </button>
          <button
            type="button"
            className={`wiki-editor__mode-btn${
              buf.mode === 'edit' ? ' is-active' : ''
            }`}
            onClick={() => buf.setMode('edit')}
          >
            편집
          </button>
        </div>
        <button
          type="button"
          className="wiki-editor__close"
          onClick={() => buf.confirmCloseIfDirty(onClose)}
          aria-label="닫기"
        >
          ×
        </button>
      </div>
      <div className="wiki-editor__body">
        {buf.loading ? (
          <div className="wiki-editor__rendered">{LOADING}</div>
        ) : buf.mode === 'read' ? (
          buf.hasContent ? (
            <div
              className="wiki-editor__rendered message-bubble__content"
              dangerouslySetInnerHTML={{ __html: renderMarkdown(buf.draft) }}
            />
          ) : (
            <div className="wiki-editor__rendered wiki-editor__rendered--empty">
              빈 파일입니다.
            </div>
          )
        ) : (
          <textarea
            className="wiki-editor__textarea"
            value={buf.draft}
            onChange={(e) => buf.setDraft(e.target.value)}
            spellCheck={false}
          />
        )}
      </div>
      <div className="wiki-editor__footer">
        <span className="wiki-editor__hint">
          {buf.dirty ? (
            <span className="wiki-editor__dirty">● 저장되지 않은 변경</span>
          ) : (
            <span>{buf.original.length}자</span>
          )}
        </span>
        {buf.mode === 'edit' && (
          <>
            <button
              type="button"
              className="task-panel__btn"
              onClick={buf.revert}
              disabled={buf.saving}
            >
              취소
            </button>
            <button
              type="button"
              className="task-panel__btn task-panel__btn--primary"
              onClick={buf.save}
              disabled={buf.saving || !buf.dirty}
            >
              {buf.saving ? '저장 중...' : '저장'}
            </button>
          </>
        )}
        <button
          type="button"
          className="task-panel__btn task-panel__btn--danger"
          onClick={buf.remove}
        >
          삭제
        </button>
      </div>
    </div>
  )
}
