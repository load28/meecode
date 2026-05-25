import * as monaco from 'monaco-editor'
import { invoke } from '@tauri-apps/api/core'
import { createProtocolConnection } from 'vscode-languageserver-protocol/browser'
import {
  CompletionRequest,
  DefinitionRequest,
  DidChangeTextDocumentNotification,
  DidCloseTextDocumentNotification,
  DidOpenTextDocumentNotification,
  HoverRequest,
  InitializedNotification,
  InitializeRequest,
  PublishDiagnosticsNotification,
  type ClientCapabilities,
  type CompletionItem,
  type CompletionList,
  type Definition,
  type DefinitionLink,
  type InitializeParams,
} from 'vscode-languageserver-protocol'
import type { LspContribution } from '../plugins/types'
import { TauriMessageReader, TauriMessageWriter } from './transport'
import { getWorkspaceRootPath } from './workspace'
import {
  toLspPosition,
  toMonacoCompletion,
  toMonacoHover,
  toMonacoLocations,
  toMonacoMarker,
} from './convert'

export interface LanguageClientHandle extends monaco.IDisposable {}

const CLIENT_CAPABILITIES: ClientCapabilities = {
  textDocument: {
    synchronization: { dynamicRegistration: false },
    completion: {
      completionItem: {
        snippetSupport: true,
        documentationFormat: ['markdown', 'plaintext'],
      },
      contextSupport: true,
    },
    hover: { contentFormat: ['markdown', 'plaintext'] },
    definition: {},
    publishDiagnostics: {},
  },
  workspace: { workspaceFolders: true },
}

function rootUri(): string | null {
  const path = getWorkspaceRootPath()
  return path ? monaco.Uri.file(path).toString() : null
}

/**
 * Start an out-of-process language server for `languageId` and bridge its LSP
 * capabilities into Monaco's feature registries (completion, hover, definition,
 * diagnostics) with full-text document sync. This is the translation layer that
 * `monaco-languageclient` performs internally, done directly against standalone
 * Monaco so we keep a thin renderer.
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
  const initResult = await connection.sendRequest(
    InitializeRequest.type,
    initParams,
  )
  await connection.sendNotification(InitializedNotification.type, {})

  const disposables: monaco.IDisposable[] = []
  const docVersions = new Map<string, number>()
  const contentSubs = new Map<string, monaco.IDisposable>()

  const isOurModel = (m: monaco.editor.ITextModel) =>
    m.getLanguageId() === languageId && m.uri.scheme === 'file'

  const track = (model: monaco.editor.ITextModel) => {
    if (!isOurModel(model)) return
    const uri = model.uri.toString()
    docVersions.set(uri, 1)
    void connection.sendNotification(DidOpenTextDocumentNotification.type, {
      textDocument: { uri, languageId, version: 1, text: model.getValue() },
    })
    const changeSub = model.onDidChangeContent(() => {
      const version = (docVersions.get(uri) ?? 1) + 1
      docVersions.set(uri, version)
      void connection.sendNotification(
        DidChangeTextDocumentNotification.type,
        {
          textDocument: { uri, version },
          contentChanges: [{ text: model.getValue() }],
        },
      )
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

  const triggerCharacters =
    initResult.capabilities.completionProvider?.triggerCharacters
  disposables.push(
    monaco.languages.registerCompletionItemProvider(languageId, {
      triggerCharacters,
      async provideCompletionItems(model, position) {
        const word = model.getWordUntilPosition(position)
        const fallbackRange: monaco.IRange = {
          startLineNumber: position.lineNumber,
          startColumn: word.startColumn,
          endLineNumber: position.lineNumber,
          endColumn: word.endColumn,
        }
        const res = await connection.sendRequest(CompletionRequest.type, {
          textDocument: { uri: model.uri.toString() },
          position: toLspPosition(position),
        })
        const items: CompletionItem[] = Array.isArray(res)
          ? res
          : ((res as CompletionList | null)?.items ?? [])
        return {
          suggestions: items.map((it) => toMonacoCompletion(it, fallbackRange)),
        }
      },
    }),
  )

  if (initResult.capabilities.hoverProvider) {
    disposables.push(
      monaco.languages.registerHoverProvider(languageId, {
        async provideHover(model, position) {
          const res = await connection.sendRequest(HoverRequest.type, {
            textDocument: { uri: model.uri.toString() },
            position: toLspPosition(position),
          })
          return res ? toMonacoHover(res) : null
        },
      }),
    )
  }

  if (initResult.capabilities.definitionProvider) {
    disposables.push(
      monaco.languages.registerDefinitionProvider(languageId, {
        async provideDefinition(model, position) {
          const res = await connection.sendRequest(DefinitionRequest.type, {
            textDocument: { uri: model.uri.toString() },
            position: toLspPosition(position),
          })
          return toMonacoLocations(res as Definition | DefinitionLink[] | null)
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
      for (const d of disposables) d.dispose()
      for (const s of contentSubs.values()) s.dispose()
      connection.dispose()
      reader.dispose()
      writer.dispose()
      void invoke('lsp_stop', { id: serverId })
    },
  }
}
