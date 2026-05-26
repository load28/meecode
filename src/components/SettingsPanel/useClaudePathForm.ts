import { useEffect, useState } from 'react'
import { invoke } from '../../platform/ipc'
import { dialogOpen as openDialog } from '../../platform/ipc'
import {
  formatValidationError,
  type ClaudeStatus,
  type ValidationError,
} from '../../hooks/useClaudeStatus'

interface ValidationOk {
  path: string
}

interface Options {
  active: boolean
  status: ClaudeStatus
  onChanged: () => Promise<void> | void
}

export interface UseClaudePathFormResult {
  value: string
  busy: boolean
  error: string | null
  saved: boolean
  setValue: (next: string) => void
  /** Tauri 파일 다이얼로그를 열어 binary를 고른다. */
  browse: () => Promise<void>
  /** 백엔드의 PATH 휴리스틱으로 자동 탐색. */
  autoDiscover: () => Promise<void>
  /** validate → 저장 → status 재조회. */
  save: () => Promise<void>
}

/**
 * SettingsPanel의 Claude CLI 경로 입력 폼 상태와 액션을 한 곳에 묶은 훅.
 *
 * panel이 열릴 때(active flips true) 현재 status에서 초기값을 다시 채운다.
 * save()는 비어있으면 path=null로 unset, 값이 있으면 validate_claude_path
 * 백엔드 응답의 정규화된 path를 그대로 다시 보관한다.
 */
export function useClaudePathForm({
  active,
  status,
  onChanged,
}: Options): UseClaudePathFormResult {
  const [value, setValue] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    if (!active) return
    setValue(status.path ?? '')
    setError(status.ready ? null : formatValidationError(status.error))
    setSaved(false)
  }, [active, status.path, status.ready, status.error])

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
      const ok = await invoke<ValidationOk>('validate_claude_path', {
        path: trimmed,
      })
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

  return { value, busy, error, saved, setValue, browse, autoDiscover, save }
}
