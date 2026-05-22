import type { ClaudeStatus } from '../../hooks/useClaudeStatus'
import { useClaudePathForm } from './useClaudePathForm'
import './SettingsPanel.css'

interface Props {
  open: boolean
  onClose: () => void
  status: ClaudeStatus
  onChanged: () => Promise<void> | void
}

export function SettingsPanel({ open: visible, onClose, status, onChanged }: Props) {
  const { value, busy, error, saved, setValue, browse, autoDiscover, save } =
    useClaudePathForm({ active: visible, status, onChanged })

  if (!visible) return null

  return (
    <div className="settings-panel-overlay" onClick={onClose}>
      <div
        className="settings-panel"
        role="dialog"
        aria-label="설정"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="settings-panel__header">
          <h2>설정</h2>
          <button
            className="settings-panel__close"
            onClick={onClose}
            aria-label="닫기"
          >
            ×
          </button>
        </header>
        <section className="settings-panel__section">
          <div className="settings-panel__label-row">
            <label htmlFor="claude-path">Claude CLI Path</label>
            <StatusBadge status={status} />
          </div>
          <div className="settings-panel__row">
            <input
              id="claude-path"
              type="text"
              className="settings-panel__input"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              placeholder="/path/to/claude"
              disabled={busy}
              spellCheck={false}
              autoCorrect="off"
              autoCapitalize="off"
            />
            <button
              type="button"
              className="settings-panel__btn"
              onClick={browse}
              disabled={busy}
            >
              Browse…
            </button>
            <button
              type="button"
              className="settings-panel__btn"
              onClick={autoDiscover}
              disabled={busy}
            >
              자동 발견
            </button>
          </div>
          <p className="settings-panel__hint">
            Claude Code CLI 바이너리의 절대 경로. 예:{' '}
            <code>~/.claude/local/claude</code>
          </p>
          {error && <div className="settings-panel__error">{error}</div>}
          {saved && !error && (
            <div className="settings-panel__ok">저장되었습니다.</div>
          )}
          <div className="settings-panel__actions">
            <button
              type="button"
              className="settings-panel__save"
              onClick={save}
              disabled={busy}
            >
              {busy ? '확인 중…' : '저장'}
            </button>
          </div>
        </section>
      </div>
    </div>
  )
}

function StatusBadge({ status }: { status: ClaudeStatus }) {
  if (status.ready) {
    return <span className="settings-badge settings-badge--ok">✅ 작동 중</span>
  }
  if (status.path) {
    return <span className="settings-badge settings-badge--err">❌ 무효</span>
  }
  return <span className="settings-badge settings-badge--unset">⚪ 미설정</span>
}
