/**
 * Cross-window LSP RPC protocol — the wire contract between a window's provider
 * proxies / document mirror (the "MainThread" side, in every window) and the
 * single Language Host that owns the server connections (the "ExtHost" side, in
 * the main window). Mirrors VS Code's `MainThread ↔ ExtHost` split, with Tauri
 * window events standing in for VS Code's `RPCProtocol`.
 *
 * Transport:
 *   - Clients (any window) → host (main):   REQ (request) / NOTIFY (doc sync) / CANCEL
 *   - Host (main) → requesting client:       RES (response, addressed by label)
 *   - Host (main) → all windows (broadcast): DIAG (diagnostics)
 */
import type { Range as LspRange } from 'vscode-languageserver-protocol'

export const RPC_REQ = 'lsp:rpc-req'
export const RPC_RES = 'lsp:rpc-res'
export const RPC_CANCEL = 'lsp:rpc-cancel'
export const RPC_NOTIFY = 'lsp:rpc-notify'
export const RPC_DIAG = 'lsp:rpc-diag'
export const RPC_READY = 'lsp:rpc-ready'
/** A client window asks the host window to boot its (lazy) Language Host. */
export const RPC_WAKE = 'lsp:rpc-wake'
/** The host announces it's up so every window re-mirrors its open documents
 * (covers notifications sent before the host finished booting). */
export const RPC_HOST_UP = 'lsp:rpc-host-up'

/** Broadcast when a server finishes initializing (and again as windows join),
 * so each window can register completion/signature with the server's real
 * trigger characters — the few capabilities needed at *registration* time. */
export interface ServerReadyPayload {
  languageId: string
  completionTriggerCharacters?: string[]
  signatureTriggerCharacters?: string[]
  signatureRetriggerCharacters?: string[]
}

/** The Tauri window label that hosts the language servers. */
export const HOST_LABEL = 'main'

/** Feature requests (expect a response). */
export type FeatureMethod =
  | 'completion'
  | 'completionResolve'
  | 'hover'
  | 'signatureHelp'
  | 'definition'
  | 'references'
  | 'documentSymbol'
  | 'formatting'
  | 'rangeFormatting'
  | 'rename'
  | 'codeAction'

/** Document-sync notifications (fire-and-forget). */
export type DocMethod = 'didOpen' | 'didChange' | 'didClose' | 'didSave'

export interface ReqPayload {
  id: number
  from: string
  method: FeatureMethod
  /** `{ languageId, lsp: <LSP request params> }`. */
  params: FeatureParams
}

export interface ResPayload {
  id: number
  to: string
  ok: boolean
  result?: unknown
  error?: string
}

export interface CancelPayload {
  id: number
  from: string
}

export interface NotifyPayload {
  from: string
  method: DocMethod
  params: DocOpenParams | DocChangeParams | DocCloseParams | DocSaveParams
}

export interface DiagPayload {
  uri: string
  languageId: string
  diagnostics: unknown[]
}

/** A feature request carries the language (so the host picks the server) plus
 * the already-built LSP request params. */
export interface FeatureParams {
  languageId: string
  lsp: unknown
}

export interface DocOpenParams {
  languageId: string
  uri: string
  version: number
  text: string
  /** A re-mirror after the host (re)booted — must not inflate the open count. */
  resync?: boolean
}

/** A single content change, carrying both Monaco offsets (for the host's shadow
 * copy) and the LSP range (for incremental forwarding to the server). */
export interface DocChange {
  range: LspRange
  rangeOffset: number
  rangeLength: number
  text: string
}

export interface DocChangeParams {
  languageId: string
  uri: string
  version: number
  changes: DocChange[]
}

export interface DocCloseParams {
  languageId: string
  uri: string
}

export interface DocSaveParams {
  languageId: string
  uri: string
}

/** Apply Monaco-offset content changes to a shadow string. Monaco emits changes
 * end-of-document first, so applying them in array order with their original
 * offsets needs no re-basing. */
export function applyContentChanges(text: string, changes: DocChange[]): string {
  let out = text
  for (const c of changes) {
    out = out.slice(0, c.rangeOffset) + c.text + out.slice(c.rangeOffset + c.rangeLength)
  }
  return out
}
