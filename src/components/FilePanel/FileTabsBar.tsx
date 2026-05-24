import type { FileTab } from '../../hooks/useFileTabs'
import { basename } from './utils'

interface Props {
  tabs: FileTab[]
  activePath: string | null
  onSelect: (path: string) => void
  onClose: (path: string) => void
  onCloseAll: () => void
  onDetach?: () => void
  onDock?: () => void
}

/**
 * Row of file tabs above the editor body, plus the close-all / detach /
 * dock affordances on the right. Pure render — every interaction routes
 * through the callbacks the parent provides.
 */
export function FileTabsBar({
  tabs,
  activePath,
  onSelect,
  onClose,
  onCloseAll,
  onDetach,
  onDock,
}: Props) {
  return (
    <div className="file-panel__tabs" role="tablist">
      {tabs.map((t) => (
        <div
          key={t.path}
          role="tab"
          aria-selected={t.path === activePath}
          className={
            'file-panel__tab' + (t.path === activePath ? ' is-active' : '')
          }
        >
          <button
            type="button"
            className="file-panel__tab-button"
            onClick={() => onSelect(t.path)}
            title={t.title ?? t.path}
          >
            <span className="file-panel__tab-name">
              {t.title ?? basename(t.path)}
            </span>
            {t.pending && (
              <span
                className="file-panel__tab-marker"
                aria-label="변경 사항 있음"
                title="변경 사항 있음"
              >
                ●
              </span>
            )}
          </button>
          <button
            type="button"
            className="file-panel__tab-close"
            onClick={() => onClose(t.path)}
            aria-label="탭 닫기"
          >
            ×
          </button>
        </div>
      ))}
      {tabs.length > 1 && (
        <button
          type="button"
          className="file-panel__close-all"
          onClick={onCloseAll}
          title="모두 닫기"
        >
          ×× 모두 닫기
        </button>
      )}
      {onDetach && (
        <button
          type="button"
          className="file-panel__action"
          onClick={onDetach}
          title="별도 창으로 분리"
        >
          ⧉ 분리
        </button>
      )}
      {onDock && (
        <button
          type="button"
          className="file-panel__action"
          onClick={onDock}
          title="메인 창으로 도킹"
        >
          ⊟ 도킹
        </button>
      )}
    </div>
  )
}
