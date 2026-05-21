import { useEffect, useState } from 'react'
import { renderMarkdown } from '../MessageBubble'
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

type Mode = 'read' | 'edit'

export function WikiEditor({
  taskId,
  name,
  onClose,
  readFile,
  writeFile,
  deleteFile,
}: Props) {
  const [mode, setMode] = useState<Mode>('read')
  const [original, setOriginal] = useState('')
  const [draft, setDraft] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  // Reload on file change. `taskId` is in the dep list so switching
  // detail views also re-fetches.
  useEffect(() => {
    let cancelled = false
    setLoading(true)
    void readFile(name).then((body) => {
      if (cancelled) return
      setOriginal(body)
      setDraft(body)
      setLoading(false)
    })
    return () => {
      cancelled = true
    }
  }, [taskId, name, readFile])

  const dirty = draft !== original
  const hasContent = draft.trim().length > 0 || original.trim().length > 0

  const handleSave = async () => {
    setSaving(true)
    try {
      const ok = await writeFile(name, draft)
      if (ok) {
        setOriginal(draft)
        setMode('read')
      }
    } finally {
      setSaving(false)
    }
  }

  const handleRevert = () => {
    setDraft(original)
    setMode('read')
  }

  const handleDelete = async () => {
    if (!confirm(`위키 파일 "${name}"을(를) 삭제하시겠습니까?`)) return
    await deleteFile(name)
    onClose()
  }

  return (
    <div className="wiki-editor">
      <div className="wiki-editor__header">
        <span className="wiki-editor__name">{name}</span>
        <div className="wiki-editor__mode" role="group" aria-label="모드 전환">
          <button
            type="button"
            className={`wiki-editor__mode-btn${mode === 'read' ? ' is-active' : ''}`}
            onClick={() => setMode('read')}
          >
            읽기
          </button>
          <button
            type="button"
            className={`wiki-editor__mode-btn${mode === 'edit' ? ' is-active' : ''}`}
            onClick={() => setMode('edit')}
          >
            편집
          </button>
        </div>
        <button
          type="button"
          className="wiki-editor__close"
          onClick={() => {
            if (dirty && !confirm('저장하지 않은 변경 사항이 있습니다. 닫으시겠습니까?')) {
              return
            }
            onClose()
          }}
          aria-label="닫기"
        >
          ×
        </button>
      </div>
      <div className="wiki-editor__body">
        {loading ? (
          <div className="wiki-editor__rendered">불러오는 중...</div>
        ) : mode === 'read' ? (
          hasContent ? (
            <div
              className="wiki-editor__rendered message-bubble__content"
              dangerouslySetInnerHTML={{ __html: renderMarkdown(draft) }}
            />
          ) : (
            <div className="wiki-editor__rendered" style={{ color: '#6e7681' }}>
              빈 파일입니다.
            </div>
          )
        ) : (
          <textarea
            className="wiki-editor__textarea"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            spellCheck={false}
          />
        )}
      </div>
      <div className="wiki-editor__footer">
        <span className="wiki-editor__hint">
          {dirty ? (
            <span className="wiki-editor__dirty">● 저장되지 않은 변경</span>
          ) : (
            <span>{original.length}자</span>
          )}
        </span>
        {mode === 'edit' && (
          <>
            <button
              type="button"
              className="task-panel__btn"
              onClick={handleRevert}
              disabled={saving}
            >
              취소
            </button>
            <button
              type="button"
              className="task-panel__btn task-panel__btn--primary"
              onClick={handleSave}
              disabled={saving || !dirty}
            >
              {saving ? '저장 중...' : '저장'}
            </button>
          </>
        )}
        <button
          type="button"
          className="task-panel__btn task-panel__btn--danger"
          onClick={handleDelete}
        >
          삭제
        </button>
      </div>
    </div>
  )
}
