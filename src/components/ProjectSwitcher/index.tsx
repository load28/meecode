import { useCallback, useEffect, useRef, useState } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { open } from '@tauri-apps/plugin-dialog'
import { useClickOutside } from '../../hooks/useClickOutside'
import { logBackendError } from '../../utils/log'
import { RecentProjectsList, type ProjectInfo } from './RecentProjectsList'
import './ProjectSwitcher.css'

interface Props {
  currentPath: string
  onSwitch: (path: string) => void
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
      logBackendError('meecode', 'list_recent_projects', e)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (open_) load()
  }, [open_, load])

  useClickOutside(ref, open_, () => setOpen(false))

  const pickFolder = async () => {
    const selected = await open({ directory: true, multiple: false })
    if (!selected || typeof selected !== 'string') return
    setOpen(false)
    onSwitch(selected)
  }

  const handlePick = (path: string) => {
    setOpen(false)
    if (path !== currentPath) onSwitch(path)
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
          <RecentProjectsList
            loading={loading}
            projects={projects}
            currentPath={currentPath}
            onPick={handlePick}
          />
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
