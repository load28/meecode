import * as monaco from 'monaco-editor'
import { listen } from '@tauri-apps/api/event'
import type {
  CompletionItem,
  CompletionList,
  Definition,
  DefinitionLink,
  Diagnostic,
  DocumentSymbol,
  Hover,
  Location as LspLocation,
  SignatureHelp,
  SymbolInformation,
  TextEdit as LspTextEdit,
  WorkspaceEdit as LspWorkspaceEdit,
} from 'vscode-languageserver-protocol'
import { isTruncatedPath } from '../models'
import type { LanguageBridge } from './bridge'
import { onDocumentSaved } from './saveNotifier'
import {
  RPC_DIAG,
  RPC_HOST_UP,
  RPC_READY,
  type DiagPayload,
  type DocChange,
  type ServerReadyPayload,
} from './protocol'
import {
  mergeResolvedCompletion,
  toLspPosition,
  toLspRange,
  toMonacoCodeActions,
  toLspDiagnostic,
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

/**
 * A window's "MainThread" side: Monaco provider proxies that forward to the
 * Language Host over a bridge, the document mirror that streams this window's
 * model edits to the host, and the diagnostics sink. Lives in every window
 * (the host window included). The host owns the servers; this is purely UI glue
 * and conversion — mirroring VS Code's `MainThreadLanguageFeatures`.
 */
export class LanguageClientView {
  private readonly languages = new Set<string>()
  private readonly staticDisposables = new Map<string, monaco.IDisposable[]>()
  // Completion + signature help are (re)registered when the server reports its
  // trigger characters, so they're tracked separately and replaceable.
  private readonly dynamicDisposables = new Map<string, monaco.IDisposable[]>()
  private readonly readySig = new Map<string, string>()
  private readonly docVersions = new Map<string, number>()
  private readonly contentSubs = new Map<string, monaco.IDisposable>()
  private hostUp = false
  private wakeTries = 0

  constructor(private readonly bridge: LanguageBridge) {
    void listen<DiagPayload>(RPC_DIAG, (e) => this.applyDiagnostics(e.payload))
    void listen<ServerReadyPayload>(RPC_READY, (e) => this.onServerReady(e.payload))
    // The host (re)booted — re-mirror our open documents so notifications that
    // raced the boot aren't lost.
    void listen(RPC_HOST_UP, () => {
      this.hostUp = true
      this.resync()
    })
    monaco.editor.onDidCreateModel((m) => this.maybeTrack(m))
    onDocumentSaved((path) => this.onSaved(path))
  }

  // A remote view must wake the host window before its notifications land.
  // Retried (bounded) until the host confirms it's up, since the wake can race
  // this window's own async listener setup.
  private pokeHost(): void {
    if (this.hostUp || this.wakeTries >= 6) return
    this.wakeTries++
    this.bridge.wake()
    setTimeout(() => this.pokeHost(), 400)
  }

  /** Re-send didOpen for every document we currently mirror (idempotent on the
   * host via the `resync` flag, so it never inflates the open count). */
  private resync(): void {
    for (const [uri, version] of this.docVersions) {
      const model = monaco.editor.getModel(monaco.Uri.parse(uri))
      if (!model) continue
      this.bridge.notifyDoc('didOpen', {
        languageId: model.getLanguageId(),
        uri,
        version,
        text: model.getValue(),
        resync: true,
      })
    }
  }

  /** Activate a language in this window: register the static providers and start
   * mirroring this window's models. Completion/signature wait for trigger chars. */
  ensureLanguage(languageId: string): void {
    if (this.languages.has(languageId)) return
    this.languages.add(languageId)
    if (this.bridge.needsWake && !this.hostUp) this.pokeHost()
    this.registerStaticProviders(languageId)
    for (const m of monaco.editor.getModels()) this.maybeTrack(m)
  }

  /** Deactivate a language (plugin disabled): drop providers and close its docs. */
  stopLanguage(languageId: string): void {
    if (!this.languages.delete(languageId)) return
    this.readySig.delete(languageId)
    for (const map of [this.staticDisposables, this.dynamicDisposables]) {
      const ds = map.get(languageId)
      if (ds) for (const d of ds) d.dispose()
      map.delete(languageId)
    }
    for (const [uri, sub] of [...this.contentSubs]) {
      const model = monaco.editor.getModel(monaco.Uri.parse(uri))
      if (!model || model.getLanguageId() !== languageId) continue
      this.bridge.notifyDoc('didClose', { languageId, uri })
      sub.dispose()
      this.contentSubs.delete(uri)
      this.docVersions.delete(uri)
    }
  }

  private applyDiagnostics({ uri, languageId, diagnostics }: DiagPayload): void {
    const model = monaco.editor.getModel(monaco.Uri.parse(uri))
    if (!model) return
    monaco.editor.setModelMarkers(
      model,
      `lsp:${languageId}`,
      (diagnostics as Diagnostic[]).map(toMonacoMarker),
    )
  }

  private isOurModel(model: monaco.editor.ITextModel, languageId: string): boolean {
    return (
      model.getLanguageId() === languageId &&
      model.uri.scheme === 'file' &&
      !isTruncatedPath(model.uri.fsPath)
    )
  }

  private maybeTrack(model: monaco.editor.ITextModel): void {
    const languageId = model.getLanguageId()
    if (!this.languages.has(languageId)) return
    if (!this.isOurModel(model, languageId)) return
    const uri = model.uri.toString()
    if (this.docVersions.has(uri)) return
    this.docVersions.set(uri, 1)
    this.bridge.notifyDoc('didOpen', {
      languageId,
      uri,
      version: 1,
      text: model.getValue(),
    })
    const sub = model.onDidChangeContent((e) => {
      const version = (this.docVersions.get(uri) ?? 1) + 1
      this.docVersions.set(uri, version)
      const changes: DocChange[] = e.changes.map((c) => ({
        range: toLspRange(c.range),
        rangeOffset: c.rangeOffset,
        rangeLength: c.rangeLength,
        text: c.text,
      }))
      this.bridge.notifyDoc('didChange', { languageId, uri, version, changes })
    })
    this.contentSubs.set(uri, sub)
    const dsub = model.onWillDispose(() => {
      this.bridge.notifyDoc('didClose', { languageId, uri })
      sub.dispose()
      dsub.dispose()
      this.contentSubs.delete(uri)
      this.docVersions.delete(uri)
    })
  }

  private onSaved(path: string): void {
    const model = monaco.editor.getModel(monaco.Uri.file(path))
    if (!model) return
    const languageId = model.getLanguageId()
    const uri = model.uri.toString()
    if (!this.languages.has(languageId) || !this.docVersions.has(uri)) return
    this.bridge.notifyDoc('didSave', { languageId, uri })
  }

  private onServerReady(payload: ServerReadyPayload): void {
    const { languageId } = payload
    if (!this.languages.has(languageId)) return
    const sig = JSON.stringify(payload)
    if (this.readySig.get(languageId) === sig) return
    this.readySig.set(languageId, sig)
    const prev = this.dynamicDisposables.get(languageId)
    if (prev) for (const d of prev) d.dispose()
    this.dynamicDisposables.set(languageId, this.registerDynamicProviders(payload))
  }

  private registerStaticProviders(languageId: string): void {
    const bridge = this.bridge
    const td = (model: monaco.editor.ITextModel) => ({ uri: model.uri.toString() })
    const ds: monaco.IDisposable[] = [
      monaco.languages.registerHoverProvider(languageId, {
        async provideHover(model, position, token) {
          const res = await bridge.request<Hover>(
            'hover',
            { languageId, lsp: { textDocument: td(model), position: toLspPosition(position) } },
            token,
          )
          return res ? toMonacoHover(res) : null
        },
      }),
      monaco.languages.registerDefinitionProvider(languageId, {
        async provideDefinition(model, position, token) {
          const res = await bridge.request<Definition | DefinitionLink[]>(
            'definition',
            { languageId, lsp: { textDocument: td(model), position: toLspPosition(position) } },
            token,
          )
          return toMonacoLocations(res)
        },
      }),
      monaco.languages.registerReferenceProvider(languageId, {
        async provideReferences(model, position, context, token) {
          const res = await bridge.request<LspLocation[]>(
            'references',
            {
              languageId,
              lsp: {
                textDocument: td(model),
                position: toLspPosition(position),
                context: { includeDeclaration: context.includeDeclaration },
              },
            },
            token,
          )
          return toMonacoLocationList(res)
        },
      }),
      monaco.languages.registerDocumentSymbolProvider(languageId, {
        async provideDocumentSymbols(model, token) {
          const res = await bridge.request<DocumentSymbol[] | SymbolInformation[]>(
            'documentSymbol',
            { languageId, lsp: { textDocument: td(model) } },
            token,
          )
          return toMonacoSymbols(res)
        },
      }),
      monaco.languages.registerDocumentFormattingEditProvider(languageId, {
        async provideDocumentFormattingEdits(model, options, token) {
          const res = await bridge.request<LspTextEdit[]>(
            'formatting',
            {
              languageId,
              lsp: {
                textDocument: td(model),
                options: { tabSize: options.tabSize, insertSpaces: options.insertSpaces },
              },
            },
            token,
          )
          return toMonacoTextEdits(res ?? undefined) ?? []
        },
      }),
      monaco.languages.registerDocumentRangeFormattingEditProvider(languageId, {
        async provideDocumentRangeFormattingEdits(model, range, options, token) {
          const res = await bridge.request<LspTextEdit[]>(
            'rangeFormatting',
            {
              languageId,
              lsp: {
                textDocument: td(model),
                range: toLspRange(range),
                options: { tabSize: options.tabSize, insertSpaces: options.insertSpaces },
              },
            },
            token,
          )
          return toMonacoTextEdits(res ?? undefined) ?? []
        },
      }),
      monaco.languages.registerRenameProvider(languageId, {
        async provideRenameEdits(model, position, newName, token) {
          const res = await bridge.request<LspWorkspaceEdit>(
            'rename',
            {
              languageId,
              lsp: { textDocument: td(model), position: toLspPosition(position), newName },
            },
            token,
          )
          return toMonacoWorkspaceEdit(res)
        },
      }),
      monaco.languages.registerCodeActionProvider(languageId, {
        async provideCodeActions(model, range, context, token) {
          const res = await bridge.request<Parameters<typeof toMonacoCodeActions>[0]>(
            'codeAction',
            {
              languageId,
              lsp: {
                textDocument: td(model),
                range: toLspRange(range),
                context: {
                  diagnostics: context.markers.map(toLspDiagnostic),
                  only: context.only ? [context.only] : undefined,
                },
              },
            },
            token,
          )
          return toMonacoCodeActions(res)
        },
      }),
    ]
    this.staticDisposables.set(languageId, ds)
  }

  private registerDynamicProviders(
    payload: ServerReadyPayload,
  ): monaco.IDisposable[] {
    const bridge = this.bridge
    const languageId = payload.languageId
    const td = (model: monaco.editor.ITextModel) => ({ uri: model.uri.toString() })
    return [
      monaco.languages.registerCompletionItemProvider(languageId, {
        triggerCharacters: payload.completionTriggerCharacters,
        async provideCompletionItems(model, position, _ctx, token) {
          const word = model.getWordUntilPosition(position)
          const fallbackRange: monaco.IRange = {
            startLineNumber: position.lineNumber,
            startColumn: word.startColumn,
            endLineNumber: position.lineNumber,
            endColumn: word.endColumn,
          }
          const res = await bridge.request<CompletionList | CompletionItem[]>(
            'completion',
            { languageId, lsp: { textDocument: td(model), position: toLspPosition(position) } },
            token,
          )
          const items: CompletionItem[] = Array.isArray(res) ? res : (res?.items ?? [])
          const incomplete = !Array.isArray(res) && !!res?.isIncomplete
          return {
            incomplete,
            suggestions: items.map((it) => toMonacoCompletion(it, fallbackRange)),
          }
        },
        async resolveCompletionItem(item, token) {
          const lsp = (item as MonacoCompletionItem).__lsp
          if (!lsp) return item
          const resolved = await bridge.request<CompletionItem>(
            'completionResolve',
            { languageId, lsp },
            token,
          )
          return resolved
            ? mergeResolvedCompletion(item as MonacoCompletionItem, resolved)
            : item
        },
      }),
      monaco.languages.registerSignatureHelpProvider(languageId, {
        signatureHelpTriggerCharacters: payload.signatureTriggerCharacters,
        signatureHelpRetriggerCharacters: payload.signatureRetriggerCharacters,
        async provideSignatureHelp(model, position, token) {
          const res = await bridge.request<SignatureHelp>(
            'signatureHelp',
            { languageId, lsp: { textDocument: td(model), position: toLspPosition(position) } },
            token,
          )
          return toMonacoSignatureHelp(res)
        },
      }),
    ]
  }
}
