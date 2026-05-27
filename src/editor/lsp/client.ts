import * as monaco from 'monaco-editor'
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
  type CompletionItem,
  type CompletionList,
  type Definition,
  type DefinitionLink,
  type Diagnostic,
  type DocumentSymbol,
  type Hover,
  type InitializeParams,
  type Location as LspLocation,
  type ProtocolConnection,
  type ServerCapabilities,
  type SignatureHelp,
  type SymbolInformation,
  type TextEdit as LspTextEdit,
  type WorkspaceEdit as LspWorkspaceEdit,
} from 'vscode-languageserver-protocol'
import type { CancellationToken } from 'vscode-jsonrpc'
import { invoke } from '../../platform/ipc'
import { isTruncatedPath } from '../models'
import type { LspContribution } from '../plugins/types'
import {
  mergeResolvedCompletion,
  toLspDiagnostic,
  toLspPosition,
  toLspRange,
  toMonacoCodeActions,
  toMonacoCompletion,
  toMonacoHover,
  toMonacoLocationList,
  toMonacoLocations,
  toMonacoMarker,
  toMonacoSignatureHelp,
  toMonacoSymbols,
  toMonacoTextEdits,
  toMonacoWorkspaceEdit,
  type MonacoCompletionItem,
} from './convert'
import { onDocumentSaved } from './saveNotifier'
import { LspMessageReader, LspMessageWriter } from './transport'
import { getWorkspaceRootPath } from './workspace'

const CLIENT_CAPABILITIES: ClientCapabilities = {
  textDocument: {
    synchronization: { dynamicRegistration: false, didSave: true, willSave: false },
    completion: {
      completionItem: {
        snippetSupport: true,
        documentationFormat: ['markdown', 'plaintext'],
        resolveSupport: { properties: ['documentation', 'detail', 'additionalTextEdits'] },
      },
      contextSupport: true,
    },
    hover: { contentFormat: ['markdown', 'plaintext'] },
    signatureHelp: { signatureInformation: { documentationFormat: ['markdown', 'plaintext'] } },
    definition: { linkSupport: true },
    references: {},
    documentSymbol: { hierarchicalDocumentSymbolSupport: true },
    formatting: {},
    rangeFormatting: {},
    rename: { prepareSupport: false },
    codeAction: {
      codeActionLiteralSupport: {
        codeActionKind: { valueSet: ['quickfix', 'refactor', 'source', 'source.organizeImports'] },
      },
    },
    publishDiagnostics: {},
  },
  workspace: { workspaceFolders: true },
}

/** Monaco's cancellation token is structurally compatible with vscode-jsonrpc's. */
function asToken(token: monaco.CancellationToken): CancellationToken {
  return token as unknown as CancellationToken
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
 * Start (or no-op if already up) a single language server for `languageId` and
 * wire it to Monaco: register capability-gated providers against the one global
 * registry and stream document edits. There is exactly one client per language
 * in the renderer (VS Code's model — auxiliary windows share this registry), so
 * no cross-window plumbing is needed.
 */
export async function startLanguageClient(
  languageId: string,
  lsp: LspContribution,
): Promise<monaco.IDisposable> {
  const serverId = `lsp-${languageId}`
  await invoke('lsp_start', {
    args: { id: serverId, command: lsp.command, args: lsp.args ?? [] },
  })

  const reader = new LspMessageReader(serverId)
  const writer = new LspMessageWriter(serverId)
  const connection: ProtocolConnection = createProtocolConnection(reader, writer)
  connection.listen()

  const rootPath = getWorkspaceRootPath()
  const rootUri = rootPath ? monaco.Uri.file(rootPath).toString() : null
  const initParams: InitializeParams = {
    processId: null,
    rootUri,
    workspaceFolders: rootUri ? [{ uri: rootUri, name: 'workspace' }] : null,
    initializationOptions: lsp.initializationOptions,
    capabilities: CLIENT_CAPABILITIES,
  }
  const initResult = await connection.sendRequest(InitializeRequest.type, initParams)
  await connection.sendNotification(InitializedNotification.type, {})
  const caps = initResult.capabilities
  const incremental = syncIsIncremental(caps)
  const includeTextOnSave = saveIncludesText(caps)

  const disposables: monaco.IDisposable[] = []
  const td = (model: monaco.editor.ITextModel) => ({ uri: model.uri.toString() })

  // ── diagnostics ────────────────────────────────────────────────────────────
  connection.onNotification(PublishDiagnosticsNotification.type, (params) => {
    const model = monaco.editor.getModel(monaco.Uri.parse(params.uri))
    if (!model) return
    monaco.editor.setModelMarkers(
      model,
      `lsp:${languageId}`,
      (params.diagnostics as Diagnostic[]).map(toMonacoMarker),
    )
  })

  // ── document synchronization ────────────────────────────────────────────────
  const versions = new Map<string, number>()
  const contentSubs = new Map<string, monaco.IDisposable>()
  const isOurModel = (m: monaco.editor.ITextModel) =>
    m.getLanguageId() === languageId && m.uri.scheme === 'file' && !isTruncatedPath(m.uri.fsPath)

  const track = (model: monaco.editor.ITextModel) => {
    if (!isOurModel(model)) return
    const uri = model.uri.toString()
    if (versions.has(uri)) return
    versions.set(uri, 1)
    void connection.sendNotification(DidOpenTextDocumentNotification.type, {
      textDocument: { uri, languageId, version: 1, text: model.getValue() },
    })
    const sub = model.onDidChangeContent((e) => {
      const version = (versions.get(uri) ?? 1) + 1
      versions.set(uri, version)
      const contentChanges = incremental
        ? e.changes.map((c) => ({
            range: toLspRange(c.range),
            rangeLength: c.rangeLength,
            text: c.text,
          }))
        : [{ text: model.getValue() }]
      void connection.sendNotification(DidChangeTextDocumentNotification.type, {
        textDocument: { uri, version },
        contentChanges,
      })
    })
    contentSubs.set(uri, sub)
    const dsub = model.onWillDispose(() => {
      void connection.sendNotification(DidCloseTextDocumentNotification.type, {
        textDocument: { uri },
      })
      sub.dispose()
      dsub.dispose()
      contentSubs.delete(uri)
      versions.delete(uri)
    })
  }

  for (const m of monaco.editor.getModels()) track(m)
  disposables.push(monaco.editor.onDidCreateModel((m) => track(m)))
  const unsubSaved = onDocumentSaved((path) => {
    const model = monaco.editor.getModel(monaco.Uri.file(path))
    if (!model || model.getLanguageId() !== languageId) return
    const uri = model.uri.toString()
    if (!versions.has(uri)) return
    void connection.sendNotification(DidSaveTextDocumentNotification.type, {
      textDocument: { uri },
      text: includeTextOnSave ? model.getValue() : undefined,
    })
  })
  disposables.push({ dispose: unsubSaved })

  // ── providers (capability-gated) ────────────────────────────────────────────
  if (caps.completionProvider) {
    disposables.push(
      monaco.languages.registerCompletionItemProvider(languageId, {
        triggerCharacters: caps.completionProvider.triggerCharacters,
        async provideCompletionItems(model, position, _ctx, token) {
          const word = model.getWordUntilPosition(position)
          const fallbackRange: monaco.IRange = {
            startLineNumber: position.lineNumber,
            startColumn: word.startColumn,
            endLineNumber: position.lineNumber,
            endColumn: word.endColumn,
          }
          const res = await connection
            .sendRequest(
              CompletionRequest.type,
              { textDocument: td(model), position: toLspPosition(position) },
              asToken(token),
            )
            .catch(() => null)
          const items: CompletionItem[] = Array.isArray(res)
            ? res
            : ((res as CompletionList | null)?.items ?? [])
          const incomplete = !Array.isArray(res) && !!(res as CompletionList | null)?.isIncomplete
          return { incomplete, suggestions: items.map((it) => toMonacoCompletion(it, fallbackRange)) }
        },
        async resolveCompletionItem(item, token) {
          const lsp = (item as MonacoCompletionItem).__lsp
          if (!lsp || !caps.completionProvider?.resolveProvider) return item
          const resolved = await connection
            .sendRequest(CompletionResolveRequest.type, lsp, asToken(token))
            .catch(() => null)
          return resolved ? mergeResolvedCompletion(item as MonacoCompletionItem, resolved) : item
        },
      }),
    )
  }

  if (caps.hoverProvider) {
    disposables.push(
      monaco.languages.registerHoverProvider(languageId, {
        async provideHover(model, position, token) {
          const res = await connection
            .sendRequest(
              HoverRequest.type,
              { textDocument: td(model), position: toLspPosition(position) },
              asToken(token),
            )
            .catch(() => null)
          return res ? toMonacoHover(res as Hover) : null
        },
      }),
    )
  }

  if (caps.signatureHelpProvider) {
    disposables.push(
      monaco.languages.registerSignatureHelpProvider(languageId, {
        signatureHelpTriggerCharacters: caps.signatureHelpProvider.triggerCharacters,
        signatureHelpRetriggerCharacters: caps.signatureHelpProvider.retriggerCharacters,
        async provideSignatureHelp(model, position, token) {
          const res = await connection
            .sendRequest(
              SignatureHelpRequest.type,
              { textDocument: td(model), position: toLspPosition(position) },
              asToken(token),
            )
            .catch(() => null)
          return toMonacoSignatureHelp(res as SignatureHelp | null)
        },
      }),
    )
  }

  if (caps.definitionProvider) {
    disposables.push(
      monaco.languages.registerDefinitionProvider(languageId, {
        async provideDefinition(model, position, token) {
          const res = await connection
            .sendRequest(
              DefinitionRequest.type,
              { textDocument: td(model), position: toLspPosition(position) },
              asToken(token),
            )
            .catch(() => null)
          return toMonacoLocations(res as Definition | DefinitionLink[] | null)
        },
      }),
    )
  }

  if (caps.referencesProvider) {
    disposables.push(
      monaco.languages.registerReferenceProvider(languageId, {
        async provideReferences(model, position, context, token) {
          const res = await connection
            .sendRequest(
              ReferencesRequest.type,
              {
                textDocument: td(model),
                position: toLspPosition(position),
                context: { includeDeclaration: context.includeDeclaration },
              },
              asToken(token),
            )
            .catch(() => null)
          return toMonacoLocationList(res as LspLocation[] | null)
        },
      }),
    )
  }

  if (caps.documentSymbolProvider) {
    disposables.push(
      monaco.languages.registerDocumentSymbolProvider(languageId, {
        async provideDocumentSymbols(model, token) {
          const res = await connection
            .sendRequest(DocumentSymbolRequest.type, { textDocument: td(model) }, asToken(token))
            .catch(() => null)
          return toMonacoSymbols(res as DocumentSymbol[] | SymbolInformation[] | null)
        },
      }),
    )
  }

  if (caps.documentFormattingProvider) {
    disposables.push(
      monaco.languages.registerDocumentFormattingEditProvider(languageId, {
        async provideDocumentFormattingEdits(model, options, token) {
          const res = await connection
            .sendRequest(
              DocumentFormattingRequest.type,
              { textDocument: td(model), options: { tabSize: options.tabSize, insertSpaces: options.insertSpaces } },
              asToken(token),
            )
            .catch(() => null)
          return toMonacoTextEdits((res as LspTextEdit[] | null) ?? undefined) ?? []
        },
      }),
    )
  }

  if (caps.documentRangeFormattingProvider) {
    disposables.push(
      monaco.languages.registerDocumentRangeFormattingEditProvider(languageId, {
        async provideDocumentRangeFormattingEdits(model, range, options, token) {
          const res = await connection
            .sendRequest(
              DocumentRangeFormattingRequest.type,
              {
                textDocument: td(model),
                range: toLspRange(range),
                options: { tabSize: options.tabSize, insertSpaces: options.insertSpaces },
              },
              asToken(token),
            )
            .catch(() => null)
          return toMonacoTextEdits((res as LspTextEdit[] | null) ?? undefined) ?? []
        },
      }),
    )
  }

  if (caps.renameProvider) {
    disposables.push(
      monaco.languages.registerRenameProvider(languageId, {
        async provideRenameEdits(model, position, newName, token) {
          const res = await connection
            .sendRequest(
              RenameRequest.type,
              { textDocument: td(model), position: toLspPosition(position), newName },
              asToken(token),
            )
            .catch(() => null)
          return toMonacoWorkspaceEdit(res as LspWorkspaceEdit | null)
        },
      }),
    )
  }

  if (caps.codeActionProvider) {
    disposables.push(
      monaco.languages.registerCodeActionProvider(languageId, {
        async provideCodeActions(model, range, context, token) {
          const res = await connection
            .sendRequest(
              CodeActionRequest.type,
              {
                textDocument: td(model),
                range: toLspRange(range),
                context: {
                  diagnostics: context.markers.map(toLspDiagnostic),
                  only: context.only ? [context.only] : undefined,
                },
              },
              asToken(token),
            )
            .catch(() => null)
          return toMonacoCodeActions(res as Parameters<typeof toMonacoCodeActions>[0])
        },
      }),
    )
  }

  return {
    dispose: () => {
      for (const d of disposables) d.dispose()
      for (const s of contentSubs.values()) s.dispose()
      contentSubs.clear()
      versions.clear()
      void connection
        .sendRequest(ShutdownRequest.type)
        .then(() => connection.sendNotification(ExitNotification.type))
        .catch(() => {})
      reader.dispose()
      writer.dispose()
      try {
        connection.dispose()
      } catch {
        /* already gone */
      }
      void invoke('lsp_stop', { id: serverId })
    },
  }
}
