import { emit, listen } from '@tauri-apps/api/event'
import { getCurrentWebviewWindow } from '@tauri-apps/api/webviewWindow'
import { HOST_LABEL, RPC_HOST_UP, RPC_WAKE } from './protocol'

/**
 * Lightweight host supervisor, registered in the host window at startup. It
 * carries no heavy LSP code — it just waits for a client window (e.g. the
 * detached code window) to ask for the Language Host, then lazily boots the
 * runtime (which registers the host's request listeners) and announces it's up
 * so windows re-mirror documents whose notifications raced the boot.
 *
 * This covers the case where the host window itself shows no code (all files
 * are in the detached window): the host must still come up to serve it.
 */
let booting = false

export function superviseLspHost(): void {
  if (getCurrentWebviewWindow().label !== HOST_LABEL) return
  void listen(RPC_WAKE, async () => {
    if (booting) {
      // Already up (or coming up); re-announce so a late waker re-syncs.
      void emit(RPC_HOST_UP, {})
      return
    }
    booting = true
    const { getLspRuntime } = await import('./runtime')
    getLspRuntime() // creates the LanguageHost + serveHostBridge listeners
    void emit(RPC_HOST_UP, {})
  })
}
