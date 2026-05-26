/**
 * Platform IPC seam.
 *
 * Every renderer ↔ backend interaction goes through this one module so the
 * substrate swap (Tauri → Electron, migration M2) is localized here and call
 * sites never change. Today it re-exports Tauri's APIs unchanged; M2 replaces
 * the internals with Electron's `window.meecode` preload bridge while keeping
 * these exact signatures.
 *
 * Contract (intentionally mirrors @tauri-apps so migration is import-only):
 *   - invoke<T>(cmd, args?)        → backend command, Promise<T>
 *   - listen<T>(event, handler)    → backend→renderer event, Promise<UnlistenFn>
 *   - dialogOpen(options?)         → native open dialog
 */
export { invoke } from '@tauri-apps/api/core'
export { listen } from '@tauri-apps/api/event'
export type { UnlistenFn, Event as IpcEvent } from '@tauri-apps/api/event'

import type { OpenDialogOptions } from '@tauri-apps/plugin-dialog'
export type { OpenDialogOptions }

/** Native "open file/folder" dialog. */
export async function dialogOpen(
  options?: OpenDialogOptions,
): Promise<string | string[] | null> {
  const { open } = await import('@tauri-apps/plugin-dialog')
  return open(options)
}
