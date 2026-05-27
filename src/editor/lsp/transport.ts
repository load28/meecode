import { invoke, listen, type UnlistenFn } from '../../platform/ipc'
import {
  AbstractMessageReader,
  AbstractMessageWriter,
  type DataCallback,
  type Disposable,
  type Message,
  type MessageReader,
  type MessageWriter,
} from 'vscode-jsonrpc/browser'

interface LspMessageEvent {
  id: string
  message: string
}

/**
 * Reads server→client JSON-RPC messages off the `lsp:message` event stream
 * (the backend already de-framed the Content-Length envelope), filtered to this
 * server id. Messages arriving before `listen()` is wired are queued.
 */
export class LspMessageReader extends AbstractMessageReader implements MessageReader {
  private callback: DataCallback | null = null
  private unlisten: UnlistenFn | null = null
  private queue: Message[] = []

  constructor(private readonly serverId: string) {
    super()
    void listen<LspMessageEvent>('lsp:message', (e) => {
      if (e.payload.id !== this.serverId) return
      let msg: Message
      try {
        msg = JSON.parse(e.payload.message) as Message
      } catch {
        return
      }
      if (this.callback) this.callback(msg)
      else this.queue.push(msg)
    }).then((u) => {
      this.unlisten = u
    })
  }

  listen(callback: DataCallback): Disposable {
    this.callback = callback
    const queued = this.queue
    this.queue = []
    for (const m of queued) callback(m)
    return {
      dispose: () => {
        this.callback = null
      },
    }
  }

  override dispose(): void {
    this.unlisten?.()
    this.unlisten = null
    super.dispose()
  }
}

/** Writes client→server messages back through the backend, which re-frames them
 * onto the child process's stdin. */
export class LspMessageWriter extends AbstractMessageWriter implements MessageWriter {
  constructor(private readonly serverId: string) {
    super()
  }

  async write(msg: Message): Promise<void> {
    await invoke('lsp_send', {
      args: { id: this.serverId, message: JSON.stringify(msg) },
    })
  }

  end(): void {
    /* nothing buffered */
  }
}
