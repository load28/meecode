import type * as monaco from 'monaco-editor'
import { emitTo, listen } from '@tauri-apps/api/event'
import { CancellationTokenSource, type CancellationToken } from 'vscode-jsonrpc'
import type { LanguageHost } from './host'
import {
  HOST_LABEL,
  RPC_CANCEL,
  RPC_NOTIFY,
  RPC_REQ,
  RPC_RES,
  RPC_WAKE,
  type CancelPayload,
  type DocMethod,
  type FeatureMethod,
  type FeatureParams,
  type NotifyPayload,
  type ReqPayload,
  type ResPayload,
} from './protocol'

/**
 * How a window's provider proxies / document mirror reach the Language Host.
 * Transparent like VS Code's generated `ExtHost*` proxies: the caller doesn't
 * know whether the host is in-process (this window is the host) or remote
 * (reached over window events).
 */
export interface LanguageBridge {
  /** True for a remote bridge that must wake the host window before use. */
  readonly needsWake: boolean
  /** Ask the host window to boot its (lazy) Language Host. No-op in-process. */
  wake(): void
  request<R>(
    method: FeatureMethod,
    params: FeatureParams,
    token: monaco.CancellationToken,
  ): Promise<R | null>
  notifyDoc(method: DocMethod, params: NotifyPayload['params']): void
}

/** Monaco's cancellation token is structurally compatible with vscode-jsonrpc's. */
function asJsonRpc(token: monaco.CancellationToken): CancellationToken {
  return token as unknown as CancellationToken
}

/** Host window: call the host directly, no serialization. */
export class InProcessBridge implements LanguageBridge {
  readonly needsWake = false

  constructor(private readonly host: LanguageHost) {}

  wake(): void {
    /* host is in this window */
  }

  async request<R>(
    method: FeatureMethod,
    params: FeatureParams,
    token: monaco.CancellationToken,
  ): Promise<R | null> {
    return (await this.host.handleRequest(method, params, asJsonRpc(token))) as R | null
  }

  notifyDoc(method: DocMethod, params: NotifyPayload['params']): void {
    void this.host.handleDocNotify(method, params)
  }
}

/** Client window (e.g. the detached code window): RPC to the host window over
 * Tauri events, correlating responses by id and forwarding cancellation. */
export class RemoteBridge implements LanguageBridge {
  readonly needsWake = true
  private seq = 0
  private readonly pending = new Map<
    number,
    { resolve: (v: unknown) => void; reject: (e: unknown) => void }
  >()

  constructor(private readonly label: string) {
    void listen<ResPayload>(RPC_RES, (e) => {
      const res = e.payload
      if (res.to !== this.label) return
      const entry = this.pending.get(res.id)
      if (!entry) return
      this.pending.delete(res.id)
      if (res.ok) entry.resolve(res.result)
      else entry.reject(new Error(res.error ?? 'lsp rpc error'))
    })
  }

  wake(): void {
    void emitTo(HOST_LABEL, RPC_WAKE, {})
  }

  request<R>(
    method: FeatureMethod,
    params: FeatureParams,
    token: monaco.CancellationToken,
  ): Promise<R | null> {
    const id = ++this.seq
    const promise = new Promise<R | null>((resolve, reject) => {
      this.pending.set(id, {
        resolve: (v) => resolve(v as R | null),
        reject,
      })
    })
    token.onCancellationRequested(() => {
      const entry = this.pending.get(id)
      if (!entry) return
      // Tell the host to cancel, and locally settle so a never-arriving reply
      // (e.g. request sent before the host booted) can't hang or leak.
      this.pending.delete(id)
      void emitTo(HOST_LABEL, RPC_CANCEL, { id, from: this.label } satisfies CancelPayload)
      entry.resolve(null)
    })
    void emitTo(HOST_LABEL, RPC_REQ, {
      id,
      from: this.label,
      method,
      params,
    } satisfies ReqPayload)
    // Any transport / host failure degrades to "no result" so providers never throw.
    return promise.catch(() => null)
  }

  notifyDoc(method: DocMethod, params: NotifyPayload['params']): void {
    void emitTo(HOST_LABEL, RPC_NOTIFY, {
      from: this.label,
      method,
      params,
    } satisfies NotifyPayload)
  }
}

/**
 * Host window: serve remote windows' requests / notifications against the host,
 * replying addressed to the caller and honoring cancellation. Call once.
 */
export function serveHostBridge(host: LanguageHost): void {
  const inflight = new Map<string, CancellationTokenSource>()
  const key = (from: string, id: number) => `${from}:${id}`

  void listen<ReqPayload>(RPC_REQ, async (e) => {
    const { id, from, method, params } = e.payload
    const cts = new CancellationTokenSource()
    inflight.set(key(from, id), cts)
    try {
      const result = await host.handleRequest(method, params, cts.token)
      await emitTo(from, RPC_RES, { id, to: from, ok: true, result } satisfies ResPayload)
    } catch (err) {
      await emitTo(from, RPC_RES, {
        id,
        to: from,
        ok: false,
        error: String(err),
      } satisfies ResPayload)
    } finally {
      inflight.delete(key(from, id))
    }
  })

  void listen<CancelPayload>(RPC_CANCEL, (e) => {
    inflight.get(key(e.payload.from, e.payload.id))?.cancel()
  })

  void listen<NotifyPayload>(RPC_NOTIFY, (e) => {
    void host.handleDocNotify(e.payload.method, e.payload.params)
  })
}
