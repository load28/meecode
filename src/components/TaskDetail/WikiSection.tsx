import { useState } from 'react'
import type { WikiFile } from '../../types/task'
import type { ContentTab } from '../../hooks/useFileTabs'
import { WikiEditor } from '../WikiEditor'

interface Props {
  taskId: string
  files: WikiFile[]
  readFile: (name: string) => Promise<string>
  writeFile: (name: string, content: string) => Promise<boolean>
  deleteFile: (name: string) => Promise<void>
  /** Open a wiki file (rendered markdown) in the shared file viewer. */
  onOpenContent?: (tab: ContentTab) => void
}

/**
 * Wiki file list + "+ 새 파일" creator + the active WikiEditor.
 *
 * Clicking a file name opens it in the shared file viewer (rendered
 * markdown, same as a source). A per-row "✎ 편집" button opens the inline
 * WikiEditor for editing. The active-file and new-file-input state live
 * entirely inside this section.
 */
export function WikiSection({
  taskId,
  files,
  readFile,
  writeFile,
  deleteFile,
  onOpenContent,
}: Props) {
  const [activeWiki, setActiveWiki] = useState<string | null>(null)
  const [newWikiName, setNewWikiName] = useState('')
  const [showNewWikiInput, setShowNewWikiInput] = useState(false)

  const handleNewWiki = async () => {
    let name = newWikiName.trim()
    if (!name) return
    if (!name.endsWith('.md')) name = `${name}.md`
    const ok = await writeFile(name, `# ${name.replace(/\.md$/, '')}\n\n`)
    if (ok) {
      setNewWikiName('')
      setShowNewWikiInput(false)
      setActiveWiki(name)
    }
  }

  const handleOpenInViewer = async (name: string) => {
    if (!onOpenContent) return
    const content = await readFile(name)
    onOpenContent({
      key: `task-wiki:${taskId}:${name}`,
      title: name,
      content,
      language: 'markdown',
    })
  }

  return (
    <div className="task-detail__section">
      <div className="task-detail__wiki-header">
        <h3 className="task-detail__section-title task-detail__wiki-title">
          Wiki ({files.length})
        </h3>
        <button
          type="button"
          className="task-panel__btn task-detail__wiki-toggle"
          onClick={() => setShowNewWikiInput((v) => !v)}
        >
          {showNewWikiInput ? '취소' : '+ 새 파일'}
        </button>
      </div>
      {showNewWikiInput && (
        <div className="task-detail__wiki-new-row">
          <input
            className="task-panel__create-input"
            placeholder="파일명 (예: decisions)"
            value={newWikiName}
            onChange={(e) => setNewWikiName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                void handleNewWiki()
              }
            }}
            autoFocus
          />
          <button
            type="button"
            className="task-panel__btn task-panel__btn--primary"
            onClick={handleNewWiki}
            disabled={!newWikiName.trim()}
          >
            생성
          </button>
        </div>
      )}
      {files.length === 0 ? (
        <div className="task-detail__section-empty">
          위키 파일이 없습니다.
          <br />
          <span className="task-detail__section-empty-hint">
            Source를 추가하고 위 "정리" 버튼을 누르거나, 직접 새 파일을 만드세요.
          </span>
        </div>
      ) : (
        <ul className="task-detail__wiki-list">
          {files.map((f) => (
            <li
              key={f.name}
              className={
                'task-detail__wiki-item' +
                (activeWiki === f.name ? ' is-active' : '')
              }
            >
              <button
                type="button"
                className="task-detail__wiki-link"
                onClick={() => {
                  if (onOpenContent) void handleOpenInViewer(f.name)
                  else setActiveWiki((cur) => (cur === f.name ? null : f.name))
                }}
                title="파일뷰로 열기"
              >
                📄 {f.name}
              </button>
              <span className="task-detail__wiki-size">{f.size_bytes}B</span>
              <button
                type="button"
                className="task-detail__wiki-edit"
                onClick={() =>
                  setActiveWiki((cur) => (cur === f.name ? null : f.name))
                }
                title="편집"
                aria-label="편집"
              >
                ✎
              </button>
            </li>
          ))}
        </ul>
      )}
      {activeWiki && (
        <WikiEditor
          taskId={taskId}
          name={activeWiki}
          onClose={() => setActiveWiki(null)}
          readFile={readFile}
          writeFile={writeFile}
          deleteFile={deleteFile}
        />
      )}
    </div>
  )
}
