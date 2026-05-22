/**
 * Tab id minting + parsing.
 *
 * Tabs are addressed by an opaque string both in the React tree and in
 * Tauri command payloads. Keeping mint/parse in one module avoids the two
 * sides drifting on what counts as "no tab" — the empty/missing case
 * always falls back to `'main'`.
 */

import { makeLocalId } from './localId'

export const MAIN_TAB_ID = 'main'

export function makeTabId(): string {
  return makeLocalId('tab')
}

/** Read `tab_id` off any event payload, defaulting to the main tab. */
export function tabIdOf(payload: unknown): string {
  if (!payload || typeof payload !== 'object') return MAIN_TAB_ID
  const t = (payload as { tab_id?: unknown }).tab_id
  return typeof t === 'string' && t.length > 0 ? t : MAIN_TAB_ID
}
