import './SessionTabs.css'

export interface TabDescriptor {
  id: string
  label: string
  isActive: boolean
  isEmpty: boolean
}

interface Props {
  tabs: TabDescriptor[]
  onSelect: (id: string) => void
  onClose: (id: string) => void
  onNew: () => void
}

export function SessionTabs({ tabs, onSelect, onClose, onNew }: Props) {
  return (
    <div className="session-tabs" role="tablist">
      {tabs.map((t) => (
        <div
          key={t.id}
          role="tab"
          aria-selected={t.isActive}
          className={
            'session-tabs__tab' +
            (t.isActive ? ' is-active' : '') +
            (t.isEmpty ? ' is-empty' : '')
          }
        >
          <button
            type="button"
            className="session-tabs__tab-button"
            onClick={() => onSelect(t.id)}
            title={t.label}
          >
            <span className="session-tabs__tab-label">{t.label}</span>
          </button>
          {tabs.length > 1 && (
            <button
              type="button"
              className="session-tabs__close"
              onClick={() => onClose(t.id)}
              aria-label="탭 닫기"
              title="탭 닫기"
            >
              ×
            </button>
          )}
        </div>
      ))}
      <button
        type="button"
        className="session-tabs__new"
        onClick={onNew}
        aria-label="새 탭"
        title="새 탭 (Cmd/Ctrl+T)"
      >
        ＋
      </button>
    </div>
  )
}
