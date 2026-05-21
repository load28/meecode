/**
 * Per-task organize state — tracks running/idle/error so the TaskDetail
 * UI can flip the "정리" button to a spinner without each render having
 * to dispatch IPC.
 *
 * Backend events (`organize:start`, `organize:done`, `organize:exit`,
 * `organize:cancelled`, `organize:tool`) flip the slot; the UI reads
 * it via `useTaskOrganize(taskId)`.
 */
import { listen } from '@tauri-apps/api/event'
import type { OrganizeStatus } from '../types/task'

export interface OrganizeState {
  status: OrganizeStatus
  /** Brief one-line tail of activity for a footer-style indicator. */
  lastNote: string | null
  /** Source ids the most recent run included — useful when refreshing
   *  list views to know what to mark optimistically. */
  lastProcessedSourceIds: string[]
  error: string | null
}

const DEFAULT: OrganizeState = {
  status: 'idle',
  lastNote: null,
  lastProcessedSourceIds: [],
  error: null,
}

let state = new Map<string, OrganizeState>()
const subscribers = new Map<string, Set<() => void>>()

function notify(taskId: string) {
  const subs = subscribers.get(taskId)
  if (!subs) return
  for (const cb of subs) cb()
}

export function getOrganizeSnapshot(taskId: string): OrganizeState {
  return state.get(taskId) ?? DEFAULT
}

export function subscribeOrganize(
  taskId: string,
  cb: () => void,
): () => void {
  let subs = subscribers.get(taskId)
  if (!subs) {
    subs = new Set()
    subscribers.set(taskId, subs)
  }
  subs.add(cb)
  return () => {
    subs!.delete(cb)
  }
}

export function setOrganize(
  taskId: string,
  updater: (prev: OrganizeState) => OrganizeState,
): void {
  const prev = state.get(taskId) ?? DEFAULT
  const next = updater(prev)
  if (next === prev) return
  const replaced = new Map(state)
  replaced.set(taskId, next)
  state = replaced
  notify(taskId)
}

let bootstrapped = false

export function bootstrapOrganizeListeners(): void {
  if (bootstrapped) return
  bootstrapped = true

  listen<{ task_id: string; source_count: number }>('organize:start', (e) => {
    setOrganize(e.payload.task_id, () => ({
      status: 'running',
      lastNote: `정리 시작 (${e.payload.source_count}개 source)`,
      lastProcessedSourceIds: [],
      error: null,
    }))
  })

  listen<{ task_id: string; tool: string; allowed: boolean }>(
    'organize:tool',
    (e) => {
      setOrganize(e.payload.task_id, (p) => ({
        ...p,
        lastNote: `${e.payload.allowed ? '✓' : '✗'} ${e.payload.tool}`,
      }))
    },
  )

  listen<{ task_id: string; processed_source_ids: string[] }>(
    'organize:done',
    (e) => {
      setOrganize(e.payload.task_id, () => ({
        status: 'idle',
        lastNote: `${e.payload.processed_source_ids.length}개 source 처리 완료`,
        lastProcessedSourceIds: e.payload.processed_source_ids,
        error: null,
      }))
    },
  )

  listen<{ task_id: string }>('organize:exit', (e) => {
    setOrganize(e.payload.task_id, (p) => {
      // 'idle' only if we weren't already cleared by `organize:done`.
      if (p.status === 'running') {
        return {
          ...p,
          status: 'idle',
          lastNote: '세션 종료',
        }
      }
      return p
    })
  })

  listen<{ task_id: string }>('organize:cancelled', (e) => {
    setOrganize(e.payload.task_id, () => ({
      status: 'idle',
      lastNote: '취소됨',
      lastProcessedSourceIds: [],
      error: null,
    }))
  })

  listen<{ task_id: string; line: string }>('organize:stderr', (e) => {
    console.warn('[organize stderr]', e.payload.task_id, e.payload.line)
  })
}
