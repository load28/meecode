import { useEffect, useState } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { open as openDialog } from '@tauri-apps/plugin-dialog'
import {
  formatValidationError,
  type ClaudeStatus,
  type ValidationError,
} from '../../hooks/useClaudeStatus'
import { Icon } from '../Icon'
import './SettingsPanel.css'

interface Props {
  open: boolean
  onClose: () => void
  status: ClaudeStatus
  onChanged: () => Promise<void> | void
}

interface ValidationOk {
  path: string
}

export function SettingsPanel({ open: visible, onClose, status, onChanged }: Props) {
  const [value, setValue] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    if (!visible) return
    setValue(status.path ?? '')
    setError(status.ready ? null : formatValidationError(status.error))
    setSaved(false)
  }, [visible, status.path, status.ready, status.error])

  const browse = async () => {
    const picked = await openDialog({ multiple: false, directory: false })
    if (typeof picked === 'string') setValue(picked)
  }

  const autoDiscover = async () => {
    setBusy(true)
    setError(null)
    setSaved(false)
    try {
      const found = await invoke<string | null>('discover_claude_path')
      if (found) {
        setValue(found)
      } else {
        setError('자동 발견 실패 — 직접 경로를 입력하세요.')
      }
    } catch (e) {
      setError(String(e))
    } finally {
      setBusy(false)
    }
  }

  const save = async () => {
    setBusy(true)
    setError(null)
    setSaved(false)
    try {
      const trimmed = value.trim()
      if (!trimmed) {
        await invoke('set_claude_path', { path: null })
        await onChanged()
        setSaved(true)
        return
      }
      const ok = await invoke<ValidationOk>('validate_claude_path', { path: trimmed })
      await invoke('set_claude_path', { path: ok.path })
      setValue(ok.path)
      await onChanged()
      setSaved(true)
    } catch (e) {
      const ve = e as ValidationError | string
      const msg =
        typeof ve === 'object' && ve && 'kind' in ve
          ? formatValidationError(ve)
          : String(ve)
      setError(msg ?? '저장 실패')
    } finally {
      setBusy(false)
    }
  }

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
    return (
      <span className="settings-badge settings-badge--ok">
        <Icon name="check-circle" />
        <span>작동 중</span>
      </span>
    )
  }
  if (status.path) {
    return (
      <span className="settings-badge settings-badge--err">
        <Icon name="x-circle" />
        <span>무효</span>
      </span>
    )
  }
  return <span className="settings-badge settings-badge--unset">미설정</span>
}
