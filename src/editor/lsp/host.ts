import * as monaco from 'monaco-editor'
import { invoke } from '@tauri-apps/api/core'
import { emit, listen } from '@tauri-apps/api/event'
import { createProtocolConnection } from 'vscode-languageserver-protocol/browser'
import {
  CodeActionRequest,
  CompletionRequest,
  CompletionResolveRequest,
  DefinitionRequest,
  DidChangeTextDocumentNotification,
  DidCloseTextDocumentNotification,
  DidOpenTextDocumentNotification,
  DidSaveTextDocumentNotification,
  DocumentFormattingRequest,
  DocumentRangeFormattingRequest,
  DocumentSymbolRequest,
  ExitNotification,
  HoverRequest,
  InitializedNotification,
  InitializeRequest,
  PublishDiagnosticsNotification,
  ReferencesRequest,
  RenameRequest,
  ShutdownRequest,
  SignatureHelpRequest,
  TextDocumentSyncKind,
  type ClientCapabilities,
  type InitializeParams,
  type ProtocolConnection,
  type ServerCapabilities,
} from 'vscode-languageserver-protocol'
import type { CancellationToken } from 'vscode-jsonrpc'
import { BUILTIN_PLUGINS } from '../plugins/catalog'
import { isPluginEnabled } from '../plugins/registry'
import type { LspContribution } from '../plugins/types'
import { TauriMessageReader, TauriMessageWriter } from './transport'
import { getWorkspaceRootPath } from './workspace'
import {
  applyContentChanges,
  RPC_DIAG,
  RPC_READY,
  type DiagPayload,
  type DocChangeParams,
  type DocMethod,
  type DocOpenParams,
  type FeatureMethod,
  type FeatureParams,
  type ServerReadyPayload,
} from './protocol'

const MAX_RESTARTS = 4

const CLIENT_CAPABILITIES: ClientCapabilities = {
  textDocument: {
    synchronization: { dynamicRegistration: false, didSave: true, willSave: false },
    completion: {
      completionItem: {
        snippetSupport: true,
        documentationFormat: ['markdown', 'plaintext'],
        resolveSupport: {
          properties: ['documentation', 'detail', 'additionalTextEdits'],
        },
      },
      contextSupport: true,
    },
    hover: { contentFormat: ['markdown', 'plaintext'] },
    signatureHelp: {
      signatureInformation: { documentationFormat: ['markdown', 'plaintext'] },
    },
    definition: { linkSupport: true },
    references: {},
    documentSymbol: { hierarchicalDocumentSymbolSupport: true },
    formatting: {},
    rangeFormatting: {},
    rename: { prepareSupport: false },
    codeAction: {
      codeActionLiteralSupport: {
        codeActionKind: {
          valueSet: ['quickfix', 'refactor', 'source', 'source.organizeImports'],
        },
      },
    },
    publishDiagnostics: {},
  },
  workspace: { workspaceFolders: true },
}

interface ServerEntry {
  connection: ProtocolConnection
  caps: ServerCapabilities
  reader: TauriMessageReader
  writer: TauriMessageWriter
  serverId: string
  incremental: boolean
  includeTextOnSave: boolean
}

interface ShadowDoc {
  languageId: string
  version: number
  text: string
  /** Open count across windows — smooths the detach/dock handoff so the server
   * doesn't see a spurious close/reopen when both windows briefly hold a file. */
  refCount: number
}

function findLsp(languageId: string): LspContribution | undefined {
  return BUILTIN_PLUGINS.find((p) => p.id === languageId)?.lsp
}

function rootUri(): string | null {
  const path = getWorkspaceRootPath()
  return path ? monaco.Uri.file(path).toString() : null
}

function syncIsIncremental(caps: ServerCapabilities): boolean {
  const sync = caps.textDocumentSync
  const kind = typeof sync === 'number' ? sync : sync?.change
  return kind === TextDocumentSyncKind.Incremental
}

function saveIncludesText(caps: ServerCapabilities): boolean {
  const sync = caps.textDocumentSync
  if (typeof sync === 'number' || !sync?.save) return false
  return sync.save === true ? false : !!sync.save.includeText
}

/**
 * The single authoritative LSP layer (VS Code's ExtHost equivalent), living in
 * the main window. It owns one connection per language server, a shadow copy of
 * every open document (so it can serve incremental *or* full sync regardless of
 * which window edits), and broadcasts diagnostics. Windows reach it through a
 * bridge; it never touches their Monaco models.
 */
export class LanguageHost {
  private servers = new Map<string, Promise<ServerEntry | null>>()
  private docs = new Map<string, ShadowDoc>()
  private restarts = new Map<string, number>()

  constructor() {
    void listen<{ id: string }>('lsp:exit', (e) => {
      void this.onServerExit(e.payload.id)
    })
  }

  private ensureServer(languageId: string): Promise<ServerEntry | null> {
    let p = this.servers.get(languageId)
    if (!p) {
      p = this.startServer(languageId)
      this.servers.set(languageId, p)
    }
    return p
  }

  private async startServer(languageId: string): Promise<ServerEntry | null> {
    const lsp = findLsp(languageId)
    if (!lsp || !isPluginEnabled(languageId)) return null
    const serverId = `lsp-${languageId}`
    try {
      await invoke('lsp_start', {
        args: { id: serverId, command: lsp.command, args: lsp.args ?? [] },
      })
    } catch {
      return null
    }
    const reader = new TauriMessageReader(serverId)
    const writer = new TauriMessageWriter(serverId)
    const connection = createProtocolConnection(reader, writer)
    connection.listen()

    const root = rootUri()
    const initParams: InitializeParams = {
      processId: null,
      rootUri: root,
      workspaceFolders: root ? [{ uri: root, name: 'workspace' }] : null,
      initializationOptions: lsp.initializationOptions,
      capabilities: CLIENT_CAPABILITIES,
    }
    let caps: ServerCapabilities
    try {
      const initResult = await connection.sendRequest(InitializeRequest.type, initParams)
      caps = initResult.capabilities
    } catch {
      reader.dispose()
      writer.dispose()
      try {
        connection.dispose()
      } catch {
        /* already gone */
      }
      return null
    }
    void connection.sendNotification(InitializedNotification.type, {})
    connection.onNotification(PublishDiagnosticsNotification.type, (params) => {
      // Broadcast so whichever window holds the file applies the markers.
      void emit(RPC_DIAG, {
        uri: params.uri,
        languageId,
        diagnostics: params.diagnostics,
      } satisfies DiagPayload)
    })

    const entry: ServerEntry = {
      connection,
      caps,
      reader,
      writer,
      serverId,
      incremental: syncIsIncremental(caps),
      includeTextOnSave: saveIncludesText(caps),
    }
    // Re-open documents already tracked (a crash restart finds docs still open).
    for (const [uri, doc] of this.docs) {
      if (doc.languageId !== languageId) continue
      void connection.sendNotification(DidOpenTextDocumentNotification.type, {
        textDocument: { uri, languageId, version: doc.version, text: doc.text },
      })
    }
    this.announceReady(languageId, caps)
    return entry
  }

  /** Tell every window the trigger characters they need to register completion
   * and signature help (the only caps needed at registration time). */
  private announceReady(languageId: string, caps: ServerCapabilities): void {
    void emit(RPC_READY, {
      languageId,
      completionTriggerCharacters: caps.completionProvider?.triggerCharacters,
      signatureTriggerCharacters: caps.signatureHelpProvider?.triggerCharacters,
      signatureRetriggerCharacters: caps.signatureHelpProvider?.retriggerCharacters,
    } satisfies ServerReadyPayload)
  }

  /** Dispatch a feature request to the language's server, gated on capability. */
  async handleRequest(
    method: FeatureMethod,
    params: FeatureParams,
    token: CancellationToken,
  ): Promise<unknown> {
    const entry = await this.ensureServer(params.languageId)
    if (!entry) return null
    const { caps, connection } = entry
    const lsp = params.lsp as never
    try {
      switch (method) {
        case 'completion':
          return await connection.sendRequest(CompletionRequest.type, lsp, token)
        case 'completionResolve':
          return caps.completionProvider?.resolveProvider
            ? await connection.sendRequest(CompletionResolveRequest.type, lsp, token)
            : null
        case 'hover':
          return caps.hoverProvider
            ? await connection.sendRequest(HoverRequest.type, lsp, token)
            : null
        case 'signatureHelp':
          return caps.signatureHelpProvider
            ? await connection.sendRequest(SignatureHelpRequest.type, lsp, token)
            : null
        case 'definition':
          return caps.definitionProvider
            ? await connection.sendRequest(DefinitionRequest.type, lsp, token)
            : null
        case 'references':
          return caps.referencesProvider
            ? await connection.sendRequest(ReferencesRequest.type, lsp, token)
            : null
        case 'documentSymbol':
          return caps.documentSymbolProvider
            ? await connection.sendRequest(DocumentSymbolRequest.type, lsp, token)
            : null
        case 'formatting':
          return caps.documentFormattingProvider
            ? await connection.sendRequest(DocumentFormattingRequest.type, lsp, token)
            : null
        case 'rangeFormatting':
          return caps.documentRangeFormattingProvider
            ? await connection.sendRequest(DocumentRangeFormattingRequest.type, lsp, token)
            : null
        case 'rename':
          return caps.renameProvider
            ? await connection.sendRequest(RenameRequest.type, lsp, token)
            : null
        case 'codeAction':
          return caps.codeActionProvider
            ? await connection.sendRequest(CodeActionRequest.type, lsp, token)
            : null
        default:
          return null
      }
    } catch {
      return null
    }
  }

  /** Apply a window's document-sync notification, maintaining the shadow copy
   * and forwarding to the server in its preferred sync kind. */
  async handleDocNotify(
    method: DocMethod,
    params: DocOpenParams | DocChangeParams | { languageId: string; uri: string },
  ): Promise<void> {
    const entry = await this.ensureServer(params.languageId)
    if (!entry) return
    const { connection } = entry
    const uri = params.uri
    switch (method) {
      case 'didOpen': {
        const p = params as DocOpenParams
        // A late-joining window needs the trigger chars too.
        this.announceReady(p.languageId, entry.caps)
        const existing = this.docs.get(uri)
        if (existing) {
          // A resync re-mirror must not inflate the open count.
          if (!p.resync) existing.refCount++
          return
        }
        this.docs.set(uri, {
          languageId: p.languageId,
          version: p.version,
          text: p.text,
          refCount: 1,
        })
        void connection.sendNotification(DidOpenTextDocumentNotification.type, {
          textDocument: { uri, languageId: p.languageId, version: p.version, text: p.text },
        })
        break
      }
      case 'didChange': {
        const p = params as DocChangeParams
        const doc = this.docs.get(uri)
        if (!doc) return
        doc.version = p.version
        doc.text = applyContentChanges(doc.text, p.changes)
        const contentChanges = entry.incremental
          ? p.changes.map((c) => ({ range: c.range, rangeLength: c.rangeLength, text: c.text }))
          : [{ text: doc.text }]
        void connection.sendNotification(DidChangeTextDocumentNotification.type, {
          textDocument: { uri, version: doc.version },
          contentChanges,
        })
        break
      }
      case 'didClose': {
        const doc = this.docs.get(uri)
        if (!doc) return
        doc.refCount--
        if (doc.refCount > 0) return
        this.docs.delete(uri)
        void connection.sendNotification(DidCloseTextDocumentNotification.type, {
          textDocument: { uri },
        })
        break
      }
      case 'didSave': {
        const doc = this.docs.get(uri)
        if (!doc) return
        void connection.sendNotification(DidSaveTextDocumentNotification.type, {
          textDocument: { uri },
          text: entry.includeTextOnSave ? doc.text : undefined,
        })
        break
      }
    }
  }

  private async onServerExit(serverId: string): Promise<void> {
    const languageId = serverId.startsWith('lsp-') ? serverId.slice(4) : serverId
    const p = this.servers.get(languageId)
    if (!p) return // we stopped it ourselves; not a crash
    this.servers.delete(languageId)
    const entry = await p.catch(() => null)
    if (entry) {
      entry.reader.dispose()
      entry.writer.dispose()
      try {
        entry.connection.dispose()
      } catch {
        /* already gone */
      }
    }
    const n = this.restarts.get(languageId) ?? 0
    const stillOpen = [...this.docs.values()].some((d) => d.languageId === languageId)
    if (!isPluginEnabled(languageId) || !stillOpen || n >= MAX_RESTARTS) return
    this.restarts.set(languageId, n + 1)
    void this.ensureServer(languageId) // startServer re-opens the known docs
  }

  /** Stop a language's server (plugin disabled). */
  async stopServer(languageId: string): Promise<void> {
    const p = this.servers.get(languageId)
    this.servers.delete(languageId)
    this.restarts.delete(languageId)
    if (!p) return
    const entry = await p.catch(() => null)
    if (entry) {
      void entry.connection
        .sendRequest(ShutdownRequest.type)
        .then(() => entry.connection.sendNotification(ExitNotification.type))
        .catch(() => {})
      entry.reader.dispose()
      entry.writer.dispose()
      try {
        entry.connection.dispose()
      } catch {
        /* already gone */
      }
      void invoke('lsp_stop', { id: entry.serverId })
    }
    for (const [uri, doc] of [...this.docs]) {
      if (doc.languageId === languageId) this.docs.delete(uri)
    }
  }
}
