import { useCallback, useEffect, useRef, useState } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { open } from '@tauri-apps/plugin-dialog'
import './ProjectSwitcher.css'

interface ProjectInfo {
  path: string
  session_count: number
  last_modified_ms: number
}

interface Props {
  currentPath: string
  onSwitch: (path: string) => void
}

function formatRelativeTime(ms: number): string {
  if (!ms) return ''
  const diff = Date.now() - ms
  const m = Math.floor(diff / 60000)
  if (m < 1) return '방금'
  if (m < 60) return `${m}분 전`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}시간 전`
  const d = Math.floor(h / 24)
  if (d < 30) return `${d}일 전`
  const mo = Math.floor(d / 30)
  return `${mo}달 전`
}

export function ProjectSwitcher({ currentPath, onSwitch }: Props) {
  const [open_, setOpen] = useState(false)
  const [projects, setProjects] = useState<ProjectInfo[]>([])
  const [loading, setLoading] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const result = await invoke<ProjectInfo[]>('list_recent_projects')
      setProjects(result)
    } catch (e) {
      console.warn('[meecode] list_recent_projects failed', e)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (open_) load()
  }, [open_, load])

  useEffect(() => {
    if (!open_) return
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open_])

  const pickFolder = async () => {
    const selected = await open({ directory: true, multiple: false })
    if (!selected || typeof selected !== 'string') return
    setOpen(false)
    onSwitch(selected)
  }

  const current = currentPath.split('/').pop() || currentPath
  return (
    <div className="project-switcher" ref={ref}>
      <button
        type="button"
        className="project-switcher__toggle"
        onClick={() => setOpen((v) => !v)}
        title={currentPath}
      >
        <span className="project-switcher__icon">📁</span>
        <span className="project-switcher__name">{current}</span>
        <span className="project-switcher__caret">▾</span>
      </button>
      {open_ && (
        <div className="project-switcher__panel">
          <div className="project-switcher__header">최근 프로젝트</div>
          <ul className="project-switcher__list">
            {loading && (
              <li className="project-switcher__empty">불러오는 중…</li>
            )}
            {!loading && projects.length === 0 && (
              <li className="project-switcher__empty">최근 프로젝트가 없습니다.</li>
            )}
            {projects.map((p) => (
              <li key={p.path}>
                <button
                  type="button"
                  className={
                    'project-switcher__item' +
                    (p.path === currentPath ? ' is-current' : '')
                  }
                  onClick={() => {
                    setOpen(false)
                    if (p.path !== currentPath) onSwitch(p.path)
                  }}
                  title={p.path}
                >
                  <span className="project-switcher__item-name">
                    {p.path.split('/').pop() || p.path}
                  </span>
                  <span className="project-switcher__item-meta">
                    {p.session_count}개 · {formatRelativeTime(p.last_modified_ms)}
                  </span>
                  <span className="project-switcher__item-path">{p.path}</span>
                </button>
              </li>
            ))}
          </ul>
          <button
            type="button"
            className="project-switcher__add"
            onClick={pickFolder}
          >
            📂 다른 폴더 선택…
          </button>
        </div>
      )}
    </div>
  )
}
