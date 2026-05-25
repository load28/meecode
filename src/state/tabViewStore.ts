/**
 * Per-tab UI view-state store — the `saveViewState`/`restoreViewState`
 * memento analogue from VS Code's editor stack.
 *
 * Since the app now renders a single, persistent `MainLayout` for the active
 * tab and swaps its `tabId` instead of mounting one tree per tab, any
 * component-local `useState` would leak across tab switches (tab A's open
 * files showing under tab B). This store keys that UI state by tab so a
 * single reused view can read/restore the right slice when `tabId` flips —
 * exactly like VS Code restoring cursor/scroll per editor input.
 *
 * It deliberately holds only *view* state (open files, composer draft,
 * scroll, expand panel). Session/model state lives in `sessionStore`.
 */
import { useCallback, useRef, useSyncExternalStore } from 'react'

const store = new Map<string, unknown>()
const subscribers = new Map<string, Set<() => void>>()

function keyOf(tabId: string, field: string): string {
  return `${tabId}::${field}`
}

function emit(key: string): void {
  const subs = subscribers.get(key)
  if (!subs) return
  for (const cb of subs) cb()
}

/** Read a tab's field without subscribing (for use inside callbacks). */
export function peekTabState<T>(tabId: string, field: string, initial: T): T {
  const key = keyOf(tabId, field)
  return store.has(key) ? (store.get(key) as T) : initial
}

function writeTabState<T>(tabId: string, field: string, next: T): void {
  const key = keyOf(tabId, field)
  const cur = store.has(key) ? (store.get(key) as T) : undefined
  if (Object.is(cur, next)) return
  store.set(key, next)
  emit(key)
}

/**
 * Drop every field for a tab — call when a tab is closed, or when an explicit
 * project/session switch should reset its view to a clean slate. Notifies
 * subscribers of each dropped field so any mounted reader re-reads its
 * (now-default) snapshot instead of showing stale state.
 */
export function clearTabState(tabId: string): void {
  const prefix = `${tabId}::`
  for (const key of [...store.keys()]) {
    if (key.startsWith(prefix)) {
      store.delete(key)
      emit(key)
    }
  }
}

/**
 * `useState`-shaped hook backed by the per-tab store. Drop-in for a local
 * `useState`, but the value is keyed by `(tabId, field)` so it survives tab
 * switches and never bleeds between tabs.
 *
 * NOTE: pass a referentially-stable `initial` for object/array values (a
 * module-level constant), since it seeds the snapshot before the first write.
 */
export function useTabState<T>(
  tabId: string,
  field: string,
  initial: T,
): [T, (value: T | ((prev: T) => T)) => void] {
  const key = keyOf(tabId, field)
  // Freeze the very first `initial` so an inline literal passed on every
  // render can't make `getSnapshot` return a fresh reference (which would
  // loop useSyncExternalStore).
  const initialRef = useRef(initial)

  const subscribe = useCallback(
    (cb: () => void) => {
      let subs = subscribers.get(key)
      if (!subs) {
        subs = new Set()
        subscribers.set(key, subs)
      }
      subs.add(cb)
      return () => {
        subs!.delete(cb)
      }
    },
    [key],
  )

  const getSnapshot = useCallback(
    (): T => (store.has(key) ? (store.get(key) as T) : initialRef.current),
    [key],
  )

  const value = useSyncExternalStore(subscribe, getSnapshot)

  const setValue = useCallback(
    (next: T | ((prev: T) => T)) => {
      const cur = store.has(key) ? (store.get(key) as T) : initialRef.current
      const resolved =
        typeof next === 'function' ? (next as (prev: T) => T)(cur) : next
      writeTabState(tabId, field, resolved)
    },
    [key, tabId, field],
  )

  return [value, setValue]
}
