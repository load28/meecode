import { getCurrentWebviewWindow } from '@tauri-apps/api/webviewWindow'
import { InProcessBridge, RemoteBridge, serveHostBridge } from './bridge'
import { LanguageHost } from './host'
import { HOST_LABEL } from './protocol'
import { LanguageClientView } from './view'

/**
 * Per-window LSP runtime, lazily created on first language activation so the
 * protocol/host stack stays out of the startup bundle. Mirrors VS Code's split:
 *
 *   - Host window (`main`): owns the single Language Host (server connections +
 *     shadow documents), serves remote windows over the bridge, and drives its
 *     own editor through an in-process bridge.
 *   - Other windows (the detached code window): a view backed by a remote bridge
 *     that RPCs to the host window. No server runs here.
 */
export interface LspRuntime {
  ensureLanguage(languageId: string): void
  stopLanguage(languageId: string): void
}

let runtime: LspRuntime | null = null

function createRuntime(): LspRuntime {
  const label = getCurrentWebviewWindow().label
  if (label === HOST_LABEL) {
    const host = new LanguageHost()
    serveHostBridge(host)
    const view = new LanguageClientView(new InProcessBridge(host))
    return {
      ensureLanguage: (id) => view.ensureLanguage(id),
      stopLanguage: (id) => {
        view.stopLanguage(id)
        void host.stopServer(id)
      },
    }
  }
  const view = new LanguageClientView(new RemoteBridge(label))
  return {
    ensureLanguage: (id) => view.ensureLanguage(id),
    // A satellite window only tears down its own proxies/mirror; the host owns
    // server lifetime (it's stopped when disabled from the main window).
    stopLanguage: (id) => view.stopLanguage(id),
  }
}

export function getLspRuntime(): LspRuntime {
  if (!runtime) runtime = createRuntime()
  return runtime
}
