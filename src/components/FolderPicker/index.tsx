import { useEffect, useState } from 'react'
import { invoke } from '../../platform/ipc'
import { dialogOpen as open } from '../../platform/ipc'
import { relativeTimeKr } from '../../utils/format'
import { logBackendError } from '../../utils/log'

interface RecentProject {
  path: string
  session_count: number
  last_modified_ms: number
}

interface Props {
  onStart: (path: string) => void
}

export function FolderPicker({ onStart }: Props) {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [recent, setRecent] = useState<RecentProject[]>([])

  useEffect(() => {
    invoke<RecentProject[]>('list_recent_projects')
      .then(setRecent)
      .catch((e) => logBackendError('meecode', 'list_recent_projects', e))
  }, [])

  const startWith = (path: string) => {
    setError('')
    // The owning tab's MainLayout will issue `switch_session` from its
    // mount effect, which avoids the listener-vs-emit race.
    onStart(path)
  }

  const handleSelect = async () => {
    const selected = await open({ directory: true, multiple: false })
    if (!selected || typeof selected !== 'string') return
    setLoading(true)
    try {
      startWith(selected)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="folder-picker">
      <div className="folder-picker__card">
        <div className="folder-picker__logo">M</div>
        <h1 className="folder-picker__title">MeeCode</h1>
        <p className="folder-picker__desc">
          프로젝트 폴더를 선택하면 Claude Code가 해당 디렉토리에서 실행됩니다.
        </p>
        <button
          type="button"
          className="folder-picker__btn"
          onClick={handleSelect}
          disabled={loading}
        >
          {loading ? '시작 중...' : '📂 프로젝트 폴더 선택'}
        </button>
        {error && <p className="folder-picker__error">{error}</p>}
        {recent.length > 0 && (
          <div className="folder-picker__recent">
            <div className="folder-picker__recent-label">최근 프로젝트</div>
            <ul className="folder-picker__recent-list">
              {recent.slice(0, 8).map((p) => (
                <li key={p.path}>
                  <button
                    type="button"
                    className="folder-picker__recent-item"
                    onClick={() => startWith(p.path)}
                    disabled={loading}
                  >
                    <span className="folder-picker__recent-name">
                      {p.path.split('/').pop() || p.path}
                    </span>
                    <span className="folder-picker__recent-meta">
                      {p.session_count}개 · {relativeTimeKr(p.last_modified_ms)}
                    </span>
                    <span className="folder-picker__recent-path">{p.path}</span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  )
}
