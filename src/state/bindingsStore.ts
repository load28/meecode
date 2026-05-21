/**
 * Session ↔ Task binding cache.
 *
 * Keyed by session_id. The store mirrors the backend's bindings.jsonl
 * for the sessions the UI has touched — `useSessionBindings(sessionId)`
 * populates an entry on first access, and attach/detach mutate both
 * the store and the file.
 */
import type { SessionTaskBinding } from '../types/task'

interface BindingsState {
  /** sessionId → list of bindings; undefined = never loaded. */
  bySession: Map<string, SessionTaskBinding[]>
}

let state: BindingsState = { bySession: new Map() }
const subscribers = new Map<string, Set<() => void>>()

function notify(sessionId: string) {
  const subs = subscribers.get(sessionId)
  if (!subs) return
  for (const cb of subs) cb()
}

export function getBindingsSnapshot(
  sessionId: string,
): SessionTaskBinding[] | undefined {
  return state.bySession.get(sessionId)
}

export function subscribeBindings(
  sessionId: string,
  cb: () => void,
): () => void {
  let subs = subscribers.get(sessionId)
  if (!subs) {
    subs = new Set()
    subscribers.set(sessionId, subs)
  }
  subs.add(cb)
  return () => {
    subs!.delete(cb)
  }
}

export function setBindings(
  sessionId: string,
  bindings: SessionTaskBinding[],
): void {
  // Replace the map on every write so useSyncExternalStore sees a new
  // reference and re-renders subscribers — Map mutation alone wouldn't
  // trigger React's bail-out check.
  const next = new Map(state.bySession)
  next.set(sessionId, bindings)
  state = { bySession: next }
  notify(sessionId)
}

export function upsertBinding(binding: SessionTaskBinding): void {
  const prev = state.bySession.get(binding.session_id) ?? []
  if (prev.some((b) => b.task_id === binding.task_id)) {
    return // idempotent — backend agrees
  }
  setBindings(binding.session_id, [...prev, binding])
}

export function removeBinding(sessionId: string, taskId: string): void {
  const prev = state.bySession.get(sessionId)
  if (!prev) return
  setBindings(
    sessionId,
    prev.filter((b) => b.task_id !== taskId),
  )
}

/** Drop every cached binding for a task — used after `delete_task` cascades. */
export function purgeTaskFromAll(taskId: string): void {
  const next = new Map<string, SessionTaskBinding[]>()
  let changed = false
  for (const [sid, list] of state.bySession) {
    const filtered = list.filter((b) => b.task_id !== taskId)
    next.set(sid, filtered)
    if (filtered.length !== list.length) changed = true
  }
  if (!changed) return
  state = { bySession: next }
  for (const sid of state.bySession.keys()) notify(sid)
}
