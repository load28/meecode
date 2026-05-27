/**
 * Platform IPC seam.
 *
 * Every renderer ↔ backend interaction goes through this one module, so the
 * substrate is localized here. Backed by Electron's `window.meecode` preload
 * bridge (which forwards to the Rust sidecar over ndjson). Signatures mirror the
 * old `@tauri-apps/api` so call sites are unchanged from the Tauri build.
 */

export type UnlistenFn = () => void

export interface IpcEvent<T = unknown> {
  /** Channel/event name. */
  event: string
  payload: T
}

interface MeecodeBridge {
  invoke(cmd: string, args?: unknown): Promise<unknown>
  on(channel: string, cb: (payload: unknown) => void): UnlistenFn
  dialogOpen(options?: unknown): Promise<string | string[] | null>
  openExternal(url: string): Promise<void>
}

declare global {
  interface Window {
    meecode: MeecodeBridge
  }
}

/** Invoke a backend command. */
export function invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  return window.meecode.invoke(cmd, args) as Promise<T>
}

/** Subscribe to a backend→renderer event. Returns a Promise<UnlistenFn> to keep
 * the same shape Tauri's `listen` had (call sites `await` or `.then` it). */
export function listen<T>(
  event: string,
  handler: (e: IpcEvent<T>) => void,
): Promise<UnlistenFn> {
  const unlisten = window.meecode.on(event, (payload) =>
    handler({ event, payload: payload as T }),
  )
  return Promise.resolve(unlisten)
}

export interface OpenDialogOptions {
  directory?: boolean
  multiple?: boolean
  defaultPath?: string
  title?: string
}

/** Native "open file/folder" dialog. */
export function dialogOpen(
  options?: OpenDialogOptions,
): Promise<string | string[] | null> {
  return window.meecode.dialogOpen(options)
}

/** Open a URL/path in the OS default handler. */
export function openExternal(url: string): Promise<void> {
  return window.meecode.openExternal(url)
}
