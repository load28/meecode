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
  /** File explorer side panel open/closed state. */
  explorerOpen: 'meecode.explorerOpen',
} as const

/**
 * react-resizable-panels의 autoSaveId로 쓰는 키들. 라이브러리가
 * localStorage에 직접 저장하므로 우리는 같은 prefix를 일관되게 유지하기만
 * 하면 된다.
 *
 * `mainOuter`의 'knowledge' 이름은 historical alias — 옛 시절 이 사이드
 * 패널이 'Knowledge'였던 때 저장된 사용자 layout을 깨지 않기 위해 그대로
 * 둔다 (의미상으론 'Tasks 사이드바').
 */
export const PERSISTED_LAYOUT_KEYS = {
  mainOuter: 'meecode.layout.knowledge',
  innerTabPrefix: 'meecode.layout.tab.',
} as const

/** 특정 탭의 inner-PanelGroup autoSaveId를 만든다. */
export function innerLayoutKey(tabId: string): string {
  return `${PERSISTED_LAYOUT_KEYS.innerTabPrefix}${tabId}`
}

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
