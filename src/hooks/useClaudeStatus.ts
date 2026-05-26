import { useCallback, useEffect, useState } from 'react'
import { invoke } from '../platform/ipc'
import { listen } from '../platform/ipc'

export type ValidationError =
  | { kind: 'empty' }
  | { kind: 'not_found' }
  | { kind: 'not_executable' }
  | { kind: 'no_version_response'; stderr: string }
  | { kind: 'timeout' }

export interface ClaudeStatus {
  path: string | null
  ready: boolean
  error: ValidationError | null
}

const INITIAL: ClaudeStatus = { path: null, ready: false, error: null }

export function useClaudeStatus(): {
  status: ClaudeStatus
  refresh: () => Promise<void>
} {
  const [status, setStatus] = useState<ClaudeStatus>(INITIAL)

  const refresh = useCallback(async () => {
    try {
      const s = await invoke<ClaudeStatus>('get_claude_status')
      setStatus(s)
    } catch (e) {
      setStatus({
        path: null,
        ready: false,
        error: { kind: 'no_version_response', stderr: String(e) },
      })
    }
  }, [])

  useEffect(() => {
    refresh()
    const un = listen('claude_path:changed', () => {
      refresh()
    })
    return () => {
      un.then((f) => f()).catch(() => {})
    }
  }, [refresh])

  return { status, refresh }
}

export function formatValidationError(e: ValidationError | null): string | null {
  if (!e) return null
  switch (e.kind) {
    case 'empty':
      return '경로가 비어 있습니다.'
    case 'not_found':
      return '파일을 찾을 수 없습니다.'
    case 'not_executable':
      return '실행 권한이 없습니다.'
    case 'no_version_response':
      return `claude --version 응답이 비정상입니다.${e.stderr ? ` (${e.stderr.trim()})` : ''}`
    case 'timeout':
      return 'claude --version 응답이 3초 안에 오지 않았습니다.'
  }
}
