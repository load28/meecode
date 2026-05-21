/**
 * Single registry for `localStorage`-backed booleans the UI persists between
 * sessions. Centralizing the keys avoids accidental collisions and the
 * read/write helpers absorb the SSR / storage-blocked edge cases in one
 * place instead of each call site re-implementing `try/catch`.
 */

export const PERSISTED_FLAG_KEYS = {
  /** "긴 답변 자동 펼침" toggle in the header. */
  autoExpand: 'meecode.autoExpand',
  /** Tasks side panel open/closed state. */
  tasksOpen: 'meecode.tasksOpen',
} as const

export type PersistedFlagKey =
  (typeof PERSISTED_FLAG_KEYS)[keyof typeof PERSISTED_FLAG_KEYS]

export function readPersistedFlag(
  key: PersistedFlagKey,
  defaultValue: boolean,
): boolean {
  try {
    const raw = localStorage.getItem(key)
    if (raw === null) return defaultValue
    return raw === 'true'
  } catch {
    return defaultValue
  }
}

export function writePersistedFlag(
  key: PersistedFlagKey,
  value: boolean,
): void {
  try {
    localStorage.setItem(key, String(value))
  } catch {
    /* storage unavailable (private mode, quota) — ignore */
  }
}
