import { invoke } from '@tauri-apps/api/core'
import type { AssistantSegment } from '../../types'
import type { PendingEdit } from '../../hooks/useFileTabs'

export interface OpenFileOptions {
  pending?: PendingEdit | null
}

export type OpenFileFn = (path: string, opts?: OpenFileOptions) => void

export interface ToolViewProps {
  segment: Extract<AssistantSegment, { kind: 'tool_use' }>
  onOpenFile?: OpenFileFn
  defaultOpen?: boolean
}

export function openExternal(path: string) {
  invoke('open_external', { path }).catch((e) =>
    console.warn('[meecode] open_external failed', e),
  )
}

/**
 * Bind a segment's diff payload to onOpenFile so a click on the file
 * path opens the file with a "Diff | Original" toggle already populated.
 */
export function withPending(
  onOpen: OpenFileFn | undefined,
  pending: PendingEdit | null,
): OpenFileFn | undefined {
  if (!onOpen) return undefined
  if (!pending) return onOpen
  return (path) => onOpen(path, { pending })
}

export function pickString(input: unknown, key: string): string {
  if (!input || typeof input !== 'object') return ''
  const v = (input as Record<string, unknown>)[key]
  return typeof v === 'string' ? v : ''
}

export function pickArray(input: unknown, key: string): unknown[] {
  if (!input || typeof input !== 'object') return []
  const v = (input as Record<string, unknown>)[key]
  return Array.isArray(v) ? v : []
}

export function FilePath({
  path,
  onOpen,
  className = 'tool-view__path tool-view__path-link',
}: {
  path: string
  onOpen?: OpenFileFn
  className?: string
}) {
  if (!path) return null
  return (
    <button
      type="button"
      className={className}
      onClick={() => {
        if (onOpen) onOpen(path)
        else openExternal(path)
      }}
      title={onOpen ? '파일 패널에서 열기' : '외부 편집기에서 열기'}
    >
      {path}
    </button>
  )
}

export function ProgressBadge({
  segment,
}: {
  segment: Extract<AssistantSegment, { kind: 'tool_use' }>
}) {
  const latest = segment.progress?.[segment.progress.length - 1]
  if (!latest) return null
  const sec =
    typeof latest.elapsed_seconds === 'number'
      ? Math.round(latest.elapsed_seconds)
      : null
  return (
    <span className="tool-view__progress-badge">
      {latest.last_tool_name ? `↳ ${latest.last_tool_name}` : 'running'}
      {sec !== null && <> · {sec}s</>}
    </span>
  )
}
