import { useState } from 'react'
import type { WikiFile } from '../../types/task'
import { WikiEditor } from '../WikiEditor'

interface Props {
  taskId: string
  files: WikiFile[]
  readFile: (name: string) => Promise<string>
  writeFile: (name: string, content: string) => Promise<boolean>
  deleteFile: (name: string) => Promise<void>
}

/**
 * Wiki file list + "+ 새 파일" creator + the active WikiEditor.
 *
 * The active-file and new-file-input state live entirely inside this
 * section — TaskDetail's parent doesn't need to be aware of them.
 * Created files default to a `# <basename>` heading just like before.
 */
export function WikiSection({
  taskId,
  files,
  readFile,
  writeFile,
  deleteFile,
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

  return (
    <div className="task-detail__section">
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          marginBottom: 8,
        }}
      >
        <h3
          className="task-detail__section-title"
          style={{ flex: 1, margin: 0 }}
        >
          Wiki ({files.length})
        </h3>
        <button
          type="button"
          className="task-panel__btn"
          onClick={() => setShowNewWikiInput((v) => !v)}
          style={{ fontSize: 11 }}
        >
          {showNewWikiInput ? '취소' : '+ 새 파일'}
        </button>
      </div>
      {showNewWikiInput && (
        <div style={{ display: 'flex', gap: 6, marginBottom: 8 }}>
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
          <span style={{ fontSize: 11 }}>
            Source를 추가하고 위 "정리" 버튼을 누르거나, 직접 새 파일을 만드세요.
          </span>
        </div>
      ) : (
        <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
          {files.map((f) => (
            <li
              key={f.name}
              style={{
                display: 'flex',
                alignItems: 'center',
                borderRadius: 6,
                background: activeWiki === f.name ? '#161b22' : 'transparent',
                marginBottom: 2,
              }}
            >
              <button
                type="button"
                onClick={() =>
                  setActiveWiki((cur) => (cur === f.name ? null : f.name))
                }
                style={{
                  flex: 1,
                  background: 'none',
                  border: 'none',
                  color: '#c9d1d9',
                  textAlign: 'left',
                  cursor: 'pointer',
                  padding: '6px 8px',
                  fontFamily: 'ui-monospace, SFMono-Regular, monospace',
                  fontSize: 12,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                📄 {f.name}
              </button>
              <span
                style={{ fontSize: 10, color: '#6e7681', marginRight: 8 }}
              >
                {f.size_bytes}B
              </span>
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
