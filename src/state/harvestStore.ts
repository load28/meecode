/**
 * Per-task session-harvest (distill) state.
 *
 * Harvest is the "세션 → Source" pass that runs before organize: a one-shot
 * Claude process reads the chat transcript and distills it into Sources, then
 * the backend auto-chains the organize loop. This store tracks only the
 * distill stage; once it emits `harvest:done`, the existing `organizeStore`
 * takes over for the wiki stage.
 *
 * Backend events: `harvest:start`, `harvest:assistant`, `harvest:done`,
 * `harvest:error`, `harvest:exit`, `harvest:cancelled`, `harvest:stderr`.
 */
import { listen } from '@tauri-apps/api/event'
import type { HarvestStatus } from '../types/task'

export interface HarvestState {
  status: HarvestStatus
  lastNote: string | null
  /** Bumped each time a harvest run finishes, so views can refresh sources. */
  doneTick: number
  error: string | null
}

const DEFAULT: HarvestState = {
  status: 'idle',
  lastNote: null,
  doneTick: 0,
  error: null,
}

let state = new Map<string, HarvestState>()
const subscribers = new Map<string, Set<() => void>>()

function notify(taskId: string) {
  const subs = subscribers.get(taskId)
  if (!subs) return
  for (const cb of subs) cb()
}

export function getHarvestSnapshot(taskId: string): HarvestState {
  return state.get(taskId) ?? DEFAULT
}

export function subscribeHarvest(taskId: string, cb: () => void): () => void {
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

export function setHarvest(
  taskId: string,
  updater: (prev: HarvestState) => HarvestState,
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

export function bootstrapHarvestListeners(): void {
  if (bootstrapped) return
  bootstrapped = true

  listen<{ task_id: string; pair_count: number }>('harvest:start', (e) => {
    setHarvest(e.payload.task_id, (p) => ({
      ...p,
      status: 'running',
      lastNote: `세션 분석 중... (${e.payload.pair_count}개 turn)`,
      error: null,
    }))
  })

  listen<{ task_id: string }>('harvest:assistant', (e) => {
    setHarvest(e.payload.task_id, (p) =>
      p.status === 'running' ? { ...p, lastNote: '세션에서 지식 추출 중...' } : p,
    )
  })

  listen<{ task_id: string; source_count: number }>('harvest:done', (e) => {
    const n = e.payload.source_count
    setHarvest(e.payload.task_id, (p) => ({
      ...p,
      status: 'idle',
      lastNote:
        n > 0
          ? `${n}개 source 생성 → 위키 정리 시작`
          : '보관할 내용이 없어 source를 만들지 않았습니다',
      doneTick: p.doneTick + 1,
      error: null,
    }))
  })

  listen<{ task_id: string; error: string }>('harvest:error', (e) => {
    setHarvest(e.payload.task_id, (p) => ({
      ...p,
      status: 'error',
      error: e.payload.error,
    }))
  })

  listen<{ task_id: string }>('harvest:exit', (e) => {
    setHarvest(e.payload.task_id, (p) =>
      p.status === 'running'
        ? { ...p, status: 'idle', lastNote: '세션 종료' }
        : p,
    )
  })

  listen<{ task_id: string }>('harvest:cancelled', (e) => {
    setHarvest(e.payload.task_id, (p) => ({
      ...p,
      status: 'idle',
      lastNote: '취소됨',
      error: null,
    }))
  })

  listen<{ task_id: string; line: string }>('harvest:stderr', (e) => {
    console.warn('[harvest stderr]', e.payload.task_id, e.payload.line)
  })
}
