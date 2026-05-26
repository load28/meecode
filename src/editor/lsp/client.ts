import * as monaco from 'monaco-editor'
import { invoke } from '@tauri-apps/api/core'
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
  type InitializeParams,
  type ServerCapabilities,
  type TextDocumentContentChangeEvent,
} from 'vscode-languageserver-protocol'
import type { CancellationToken } from 'vscode-jsonrpc'
import type { LspContribution } from '../plugins/types'
import { isTruncatedPath } from '../models'
import { TauriMessageReader, TauriMessageWriter } from './transport'
import { getWorkspaceRootPath } from './workspace'
import { onDocumentSaved } from './saveNotifier'
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

export interface LanguageClientHandle extends monaco.IDisposable {}

const CLIENT_CAPABILITIES: ClientCapabilities = {
  textDocument: {
    synchronization: {
      dynamicRegistration: false,
      didSave: true,
      willSave: false,
    },
    completion: {
      completionItem: {
        snippetSupport: true,
        documentationFormat: ['markdown', 'plaintext'],
        resolveSupport: { properties: ['documentation', 'detail', 'additionalTextEdits'] },
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

function rootUri(): string | null {
  const path = getWorkspaceRootPath()
  return path ? monaco.Uri.file(path).toString() : null
}

/** vscode-jsonrpc accepts a structurally-compatible cancellation token; Monaco's
 * token has the same shape, so we forward it to support request cancellation. */
function asToken(token: monaco.CancellationToken): CancellationToken {
  return token as unknown as CancellationToken
}

/** Did the server ask for incremental document sync? */
function syncIsIncremental(caps: ServerCapabilities): boolean {
  const sync = caps.textDocumentSync
  const kind = typeof sync === 'number' ? sync : sync?.change
  return kind === TextDocumentSyncKind.Incremental
}

/** Does the server want the full text echoed back on save? */
function saveIncludesText(caps: ServerCapabilities): boolean {
  const sync = caps.textDocumentSync
  if (typeof sync === 'number' || !sync?.save) return false
  return sync.save === true ? false : !!sync.save.includeText
}

/**
 * Start an out-of-process language server for `languageId` and bridge its LSP
 * capabilities into Monaco's feature registries (completion + resolve, hover,
 * signature help, definition, references, document symbols, formatting, rename,
 * code actions, diagnostics) with incremental document sync. This is the
 * translation layer `monaco-languageclient` performs internally, done directly
 * against standalone Monaco so we keep a thin renderer.
 */
export async function startLanguageClient(
  languageId: string,
  lsp: LspContribution,
): Promise<LanguageClientHandle> {
  const serverId = `lsp-${languageId}`
  await invoke('lsp_start', {
    args: { id: serverId, command: lsp.command, args: lsp.args ?? [] },
  })

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
  const initResult = await connection.sendRequest(InitializeRequest.type, initParams)
  await connection.sendNotification(InitializedNotification.type, {})

  const caps = initResult.capabilities
  const incremental = syncIsIncremental(caps)
  const includeTextOnSave = saveIncludesText(caps)

  const disposables: monaco.IDisposable[] = []
  const docVersions = new Map<string, number>()
  const contentSubs = new Map<string, monaco.IDisposable>()

  // Truncated files only loaded a prefix — feeding that to the server produces
  // bogus diagnostics for the unseen remainder, so we skip them entirely.
  const isOurModel = (m: monaco.editor.ITextModel) =>
    m.getLanguageId() === languageId &&
    m.uri.scheme === 'file' &&
    !isTruncatedPath(m.uri.fsPath)

  /** Run a request, swallowing server errors / cancellations into `null` so a
   * provider never throws. The caller forwards Monaco's cancellation token into
   * `sendRequest` (see call sites) for proper request cancellation. */
  async function req<R>(send: () => Promise<R>): Promise<R | null> {
    try {
      return await send()
    } catch {
      return null
    }
  }

  const track = (model: monaco.editor.ITextModel) => {
    if (!isOurModel(model)) return
    const uri = model.uri.toString()
    if (docVersions.has(uri)) return
    docVersions.set(uri, 1)
    void connection.sendNotification(DidOpenTextDocumentNotification.type, {
      textDocument: { uri, languageId, version: 1, text: model.getValue() },
    })
    const changeSub = model.onDidChangeContent((e) => {
      const version = (docVersions.get(uri) ?? 1) + 1
      docVersions.set(uri, version)
      // Monaco hands changes back end-of-document first, which is exactly the
      // order an LSP server applies them in (earlier offsets stay valid).
      const contentChanges: TextDocumentContentChangeEvent[] = incremental
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
    contentSubs.set(uri, changeSub)
    const disposeSub = model.onWillDispose(() => {
      void connection.sendNotification(DidCloseTextDocumentNotification.type, {
        textDocument: { uri },
      })
      changeSub.dispose()
      disposeSub.dispose()
      contentSubs.delete(uri)
      docVersions.delete(uri)
    })
  }

  for (const model of monaco.editor.getModels()) track(model)
  disposables.push(monaco.editor.onDidCreateModel(track))

  // textDocument/didSave — driven by the save hook's success signal.
  disposables.push({
    dispose: onDocumentSaved((path) => {
      const uri = monaco.Uri.file(path).toString()
      if (!docVersions.has(uri)) return
      const model = monaco.editor.getModel(monaco.Uri.file(path))
      void connection.sendNotification(DidSaveTextDocumentNotification.type, {
        textDocument: { uri },
        text: includeTextOnSave ? (model?.getValue() ?? undefined) : undefined,
      })
    }),
  })

  const completionResolve = !!caps.completionProvider?.resolveProvider
  disposables.push(
    monaco.languages.registerCompletionItemProvider(languageId, {
      triggerCharacters: caps.completionProvider?.triggerCharacters,
      async provideCompletionItems(model, position, _context, token) {
        const word = model.getWordUntilPosition(position)
        const fallbackRange: monaco.IRange = {
          startLineNumber: position.lineNumber,
          startColumn: word.startColumn,
          endLineNumber: position.lineNumber,
          endColumn: word.endColumn,
        }
        const res = await req(() =>
          connection.sendRequest(
            CompletionRequest.type,
            {
              textDocument: { uri: model.uri.toString() },
              position: toLspPosition(position),
            },
            asToken(token),
          ),
        )
        const items: CompletionItem[] = Array.isArray(res)
          ? res
          : ((res as CompletionList | null)?.items ?? [])
        const incomplete =
          !Array.isArray(res) && !!(res as CompletionList | null)?.isIncomplete
        return {
          incomplete,
          suggestions: items.map((it) => toMonacoCompletion(it, fallbackRange)),
        }
      },
      resolveCompletionItem: completionResolve
        ? async (item, token) => {
            const lsp = (item as MonacoCompletionItem).__lsp
            if (!lsp) return item
            const resolved = await req(() =>
              connection.sendRequest(
                CompletionResolveRequest.type,
                lsp,
                asToken(token),
              ),
            )
            return resolved
              ? mergeResolvedCompletion(item as MonacoCompletionItem, resolved)
              : item
          }
        : undefined,
    }),
  )

  if (caps.hoverProvider) {
    disposables.push(
      monaco.languages.registerHoverProvider(languageId, {
        async provideHover(model, position, token) {
          const res = await req(() =>
            connection.sendRequest(
              HoverRequest.type,
              {
                textDocument: { uri: model.uri.toString() },
                position: toLspPosition(position),
              },
              asToken(token),
            ),
          )
          return res ? toMonacoHover(res) : null
        },
      }),
    )
  }

  if (caps.signatureHelpProvider) {
    disposables.push(
      monaco.languages.registerSignatureHelpProvider(languageId, {
        signatureHelpTriggerCharacters:
          caps.signatureHelpProvider.triggerCharacters,
        signatureHelpRetriggerCharacters:
          caps.signatureHelpProvider.retriggerCharacters,
        async provideSignatureHelp(model, position, token) {
          const res = await req(() =>
            connection.sendRequest(
              SignatureHelpRequest.type,
              {
                textDocument: { uri: model.uri.toString() },
                position: toLspPosition(position),
              },
              asToken(token),
            ),
          )
          return toMonacoSignatureHelp(res)
        },
      }),
    )
  }

  if (caps.definitionProvider) {
    disposables.push(
      monaco.languages.registerDefinitionProvider(languageId, {
        async provideDefinition(model, position, token) {
          const res = await req(() =>
            connection.sendRequest(
              DefinitionRequest.type,
              {
                textDocument: { uri: model.uri.toString() },
                position: toLspPosition(position),
              },
              asToken(token),
            ),
          )
          return toMonacoLocations(res as Definition | DefinitionLink[] | null)
        },
      }),
    )
  }

  if (caps.referencesProvider) {
    disposables.push(
      monaco.languages.registerReferenceProvider(languageId, {
        async provideReferences(model, position, context, token) {
          const res = await req(() =>
            connection.sendRequest(
              ReferencesRequest.type,
              {
                textDocument: { uri: model.uri.toString() },
                position: toLspPosition(position),
                context: { includeDeclaration: context.includeDeclaration },
              },
              asToken(token),
            ),
          )
          return toMonacoLocationList(res)
        },
      }),
    )
  }

  if (caps.documentSymbolProvider) {
    disposables.push(
      monaco.languages.registerDocumentSymbolProvider(languageId, {
        async provideDocumentSymbols(model, token) {
          const res = await req(() =>
            connection.sendRequest(
              DocumentSymbolRequest.type,
              { textDocument: { uri: model.uri.toString() } },
              asToken(token),
            ),
          )
          return toMonacoSymbols(res)
        },
      }),
    )
  }

  if (caps.documentFormattingProvider) {
    disposables.push(
      monaco.languages.registerDocumentFormattingEditProvider(languageId, {
        async provideDocumentFormattingEdits(model, options, token) {
          const res = await req(() =>
            connection.sendRequest(
              DocumentFormattingRequest.type,
              {
                textDocument: { uri: model.uri.toString() },
                options: {
                  tabSize: options.tabSize,
                  insertSpaces: options.insertSpaces,
                },
              },
              asToken(token),
            ),
          )
          return toMonacoTextEdits(res ?? undefined) ?? []
        },
      }),
    )
  }

  if (caps.documentRangeFormattingProvider) {
    disposables.push(
      monaco.languages.registerDocumentRangeFormattingEditProvider(languageId, {
        async provideDocumentRangeFormattingEdits(model, range, options, token) {
          const res = await req(() =>
            connection.sendRequest(
              DocumentRangeFormattingRequest.type,
              {
                textDocument: { uri: model.uri.toString() },
                range: toLspRange(range),
                options: {
                  tabSize: options.tabSize,
                  insertSpaces: options.insertSpaces,
                },
              },
              asToken(token),
            ),
          )
          return toMonacoTextEdits(res ?? undefined) ?? []
        },
      }),
    )
  }

  if (caps.renameProvider) {
    disposables.push(
      monaco.languages.registerRenameProvider(languageId, {
        async provideRenameEdits(model, position, newName, token) {
          const res = await req(() =>
            connection.sendRequest(
              RenameRequest.type,
              {
                textDocument: { uri: model.uri.toString() },
                position: toLspPosition(position),
                newName,
              },
              asToken(token),
            ),
          )
          return toMonacoWorkspaceEdit(res)
        },
      }),
    )
  }

  if (caps.codeActionProvider) {
    disposables.push(
      monaco.languages.registerCodeActionProvider(languageId, {
        async provideCodeActions(model, range, context, token) {
          const res = await req(() =>
            connection.sendRequest(
              CodeActionRequest.type,
              {
                textDocument: { uri: model.uri.toString() },
                range: toLspRange(range),
                context: {
                  diagnostics: context.markers.map(toLspDiagnostic),
                  only: context.only ? [context.only] : undefined,
                },
              },
              asToken(token),
            ),
          )
          return toMonacoCodeActions(res)
        },
      }),
    )
  }

  connection.onNotification(PublishDiagnosticsNotification.type, (params) => {
    const model = monaco.editor.getModel(monaco.Uri.parse(params.uri))
    if (!model) return
    monaco.editor.setModelMarkers(
      model,
      `lsp:${languageId}`,
      params.diagnostics.map(toMonacoMarker),
    )
  })

  return {
    dispose() {
      // Best-effort graceful shutdown so the server can flush state before the
      // process is killed; ignore failures (it may already be gone).
      void connection
        .sendRequest(ShutdownRequest.type)
        .then(() => connection.sendNotification(ExitNotification.type))
        .catch(() => {})
      for (const d of disposables) d.dispose()
      for (const s of contentSubs.values()) s.dispose()
      connection.dispose()
      reader.dispose()
      writer.dispose()
      void invoke('lsp_stop', { id: serverId })
    },
  }
}
