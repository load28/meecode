import { relativeTimeKr } from '../../utils/format'

export interface ProjectInfo {
  path: string
  session_count: number
  last_modified_ms: number
}

interface Props {
  loading: boolean
  projects: ProjectInfo[]
  currentPath: string
  onPick: (path: string) => void
}

/**
 * 최근 프로젝트 목록 — 로딩/빈 결과/행 렌더 세 상태를 한 곳에서 다룬다.
 * 각 행에 폴더 이름, 세션 수, 상대 시간, 전체 경로가 들어간다.
 */
export function RecentProjectsList({
  loading,
  projects,
  currentPath,
  onPick,
}: Props) {
  return (
    <ul className="project-switcher__list">
      {loading && <li className="project-switcher__empty">불러오는 중…</li>}
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
            onClick={() => onPick(p.path)}
            title={p.path}
          >
            <span className="project-switcher__item-name">
              {p.path.split('/').pop() || p.path}
            </span>
            <span className="project-switcher__item-meta">
              {p.session_count}개 · {relativeTimeKr(p.last_modified_ms)}
            </span>
            <span className="project-switcher__item-path">{p.path}</span>
          </button>
        </li>
      ))}
    </ul>
  )
}
