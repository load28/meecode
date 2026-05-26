import type { FileTab } from '../../hooks/useFileTabs'
import { useDirty } from '../../state/workingCopyStore'
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
        <FileTabItem
          key={t.path}
          tab={t}
          active={t.path === activePath}
          onSelect={onSelect}
          onClose={onClose}
        />
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

interface ItemProps {
  tab: FileTab
  active: boolean
  onSelect: (path: string) => void
  onClose: (path: string) => void
}

function FileTabItem({ tab, active, onSelect, onClose }: ItemProps) {
  // Unsaved user edits. VS Code turns the close × into a dot for dirty editors
  // (and back to × on hover so it stays closable).
  const dirty = useDirty(tab.virtual ? null : tab.path)

  return (
    <div
      role="tab"
      aria-selected={active}
      className={
        'file-panel__tab' +
        (active ? ' is-active' : '') +
        (dirty ? ' is-dirty' : '')
      }
    >
      <button
        type="button"
        className="file-panel__tab-button"
        onClick={() => onSelect(tab.path)}
        title={tab.title ?? tab.path}
      >
        <span className="file-panel__tab-name">
          {tab.title ?? basename(tab.path)}
        </span>
        {tab.pending && (
          <span
            className="file-panel__tab-marker"
            aria-label="Claude 변경 사항 있음"
            title="Claude 변경 사항 있음"
          >
            ●
          </span>
        )}
      </button>
      <button
        type="button"
        className="file-panel__tab-close"
        onClick={() => onClose(tab.path)}
        aria-label={dirty ? '저장되지 않은 변경 — 탭 닫기' : '탭 닫기'}
      >
        <span className="file-panel__tab-close-dot" aria-hidden="true">
          ●
        </span>
        <span className="file-panel__tab-close-x" aria-hidden="true">
          ×
        </span>
      </button>
    </div>
  )
}
