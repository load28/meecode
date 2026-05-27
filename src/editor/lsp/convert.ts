import * as monaco from 'monaco-editor'
import {
  CompletionItemKind as LspCompletionItemKind,
  CompletionItemTag as LspCompletionItemTag,
  DiagnosticSeverity,
  InsertTextFormat,
  SymbolKind as LspSymbolKind,
  SymbolTag as LspSymbolTag,
  type CodeAction as LspCodeAction,
  type Command as LspCommand,
  type CompletionItem as LspCompletionItem,
  type Diagnostic,
  type Definition,
  type DefinitionLink,
  type DocumentSymbol,
  type Hover,
  type Location as LspLocation,
  type MarkupContent,
  type ParameterInformation,
  type Position as LspPosition,
  type Range as LspRange,
  type SignatureHelp,
  type SignatureInformation,
  type SymbolInformation,
  type TextEdit as LspTextEdit,
  type WorkspaceEdit as LspWorkspaceEdit,
} from 'vscode-languageserver-protocol'

// LSP positions are 0-based; Monaco's are 1-based.
export function toLspPosition(p: monaco.IPosition): LspPosition {
  return { line: p.lineNumber - 1, character: p.column - 1 }
}

export function toLspRange(r: monaco.IRange): LspRange {
  return {
    start: { line: r.startLineNumber - 1, character: r.startColumn - 1 },
    end: { line: r.endLineNumber - 1, character: r.endColumn - 1 },
  }
}

export function toMonacoRange(r: LspRange): monaco.IRange {
  return {
    startLineNumber: r.start.line + 1,
    startColumn: r.start.character + 1,
    endLineNumber: r.end.line + 1,
    endColumn: r.end.character + 1,
  }
}

const COMPLETION_KIND: Record<number, monaco.languages.CompletionItemKind> = {
  [LspCompletionItemKind.Text]: monaco.languages.CompletionItemKind.Text,
  [LspCompletionItemKind.Method]: monaco.languages.CompletionItemKind.Method,
  [LspCompletionItemKind.Function]: monaco.languages.CompletionItemKind.Function,
  [LspCompletionItemKind.Constructor]:
    monaco.languages.CompletionItemKind.Constructor,
  [LspCompletionItemKind.Field]: monaco.languages.CompletionItemKind.Field,
  [LspCompletionItemKind.Variable]: monaco.languages.CompletionItemKind.Variable,
  [LspCompletionItemKind.Class]: monaco.languages.CompletionItemKind.Class,
  [LspCompletionItemKind.Interface]:
    monaco.languages.CompletionItemKind.Interface,
  [LspCompletionItemKind.Module]: monaco.languages.CompletionItemKind.Module,
  [LspCompletionItemKind.Property]: monaco.languages.CompletionItemKind.Property,
  [LspCompletionItemKind.Unit]: monaco.languages.CompletionItemKind.Unit,
  [LspCompletionItemKind.Value]: monaco.languages.CompletionItemKind.Value,
  [LspCompletionItemKind.Enum]: monaco.languages.CompletionItemKind.Enum,
  [LspCompletionItemKind.Keyword]: monaco.languages.CompletionItemKind.Keyword,
  [LspCompletionItemKind.Snippet]: monaco.languages.CompletionItemKind.Snippet,
  [LspCompletionItemKind.Color]: monaco.languages.CompletionItemKind.Color,
  [LspCompletionItemKind.File]: monaco.languages.CompletionItemKind.File,
  [LspCompletionItemKind.Reference]:
    monaco.languages.CompletionItemKind.Reference,
  [LspCompletionItemKind.Folder]: monaco.languages.CompletionItemKind.Folder,
  [LspCompletionItemKind.EnumMember]:
    monaco.languages.CompletionItemKind.EnumMember,
  [LspCompletionItemKind.Constant]: monaco.languages.CompletionItemKind.Constant,
  [LspCompletionItemKind.Struct]: monaco.languages.CompletionItemKind.Struct,
  [LspCompletionItemKind.Event]: monaco.languages.CompletionItemKind.Event,
  [LspCompletionItemKind.Operator]: monaco.languages.CompletionItemKind.Operator,
  [LspCompletionItemKind.TypeParameter]:
    monaco.languages.CompletionItemKind.TypeParameter,
}

function toMarkdown(
  value: string | MarkupContent | undefined,
): monaco.IMarkdownString | undefined {
  if (!value) return undefined
  return { value: typeof value === 'string' ? value : value.value }
}

/** A Monaco completion item carrying its source LSP item, so `resolveCompletionItem`
 * can lazily fetch details / auto-import edits via `completionItem/resolve`. */
export interface MonacoCompletionItem extends monaco.languages.CompletionItem {
  __lsp?: LspCompletionItem
}

export function toMonacoTextEdits(
  edits: LspTextEdit[] | undefined,
): monaco.languages.TextEdit[] | undefined {
  if (!edits?.length) return undefined
  return edits.map((e) => ({ range: toMonacoRange(e.range), text: e.newText }))
}

export function toMonacoCompletion(
  item: LspCompletionItem,
  fallbackRange: monaco.IRange,
): MonacoCompletionItem {
  const edit = item.textEdit
  // LSP 3.16 `InsertReplaceEdit` carries both an insert and a replace range;
  // Monaco models that as `{ insert, replace }`.
  const range =
    edit && 'range' in edit
      ? toMonacoRange(edit.range)
      : edit && 'insert' in edit
        ? { insert: toMonacoRange(edit.insert), replace: toMonacoRange(edit.replace) }
        : fallbackRange
  const insertText = edit?.newText ?? item.insertText ?? item.label
  const isSnippet = item.insertTextFormat === InsertTextFormat.Snippet
  const deprecated =
    item.deprecated || item.tags?.includes(LspCompletionItemTag.Deprecated)
  return {
    label: item.label,
    kind: COMPLETION_KIND[item.kind ?? 0] ?? monaco.languages.CompletionItemKind.Text,
    insertText,
    insertTextRules: isSnippet
      ? monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet
      : undefined,
    range,
    detail: item.detail,
    documentation: toMarkdown(item.documentation),
    sortText: item.sortText,
    filterText: item.filterText,
    commitCharacters: item.commitCharacters,
    preselect: item.preselect,
    additionalTextEdits: toMonacoTextEdits(item.additionalTextEdits),
    tags: deprecated ? [monaco.languages.CompletionItemTag.Deprecated] : undefined,
    __lsp: item,
  }
}

/** Fold a `completionItem/resolve` response back into the shown Monaco item —
 * this is how auto-import edits (`additionalTextEdits`) and lazy docs arrive. */
export function mergeResolvedCompletion(
  shown: MonacoCompletionItem,
  resolved: LspCompletionItem,
): MonacoCompletionItem {
  return {
    ...shown,
    detail: resolved.detail ?? shown.detail,
    documentation: toMarkdown(resolved.documentation) ?? shown.documentation,
    additionalTextEdits:
      toMonacoTextEdits(resolved.additionalTextEdits) ?? shown.additionalTextEdits,
  }
}

export function toMonacoHover(hover: Hover): monaco.languages.Hover {
  const { contents } = hover
  const parts: monaco.IMarkdownString[] = []
  if (typeof contents === 'string') {
    parts.push({ value: contents })
  } else if (Array.isArray(contents)) {
    for (const c of contents) {
      parts.push({ value: typeof c === 'string' ? c : `\`\`\`${c.language}\n${c.value}\n\`\`\`` })
    }
  } else {
    parts.push({ value: contents.value })
  }
  return {
    contents: parts,
    range: hover.range ? toMonacoRange(hover.range) : undefined,
  }
}

export function toMonacoLocations(
  result: Definition | DefinitionLink[] | null,
): monaco.languages.Location[] {
  if (!result) return []
  const arr = Array.isArray(result) ? result : [result]
  return arr.map((loc) =>
    'targetUri' in loc
      ? {
          uri: monaco.Uri.parse(loc.targetUri),
          range: toMonacoRange(loc.targetSelectionRange ?? loc.targetRange),
        }
      : {
          uri: monaco.Uri.parse(loc.uri),
          range: toMonacoRange(loc.range),
        },
  )
}

const MARKER_SEVERITY: Record<number, monaco.MarkerSeverity> = {
  [DiagnosticSeverity.Error]: monaco.MarkerSeverity.Error,
  [DiagnosticSeverity.Warning]: monaco.MarkerSeverity.Warning,
  [DiagnosticSeverity.Information]: monaco.MarkerSeverity.Info,
  [DiagnosticSeverity.Hint]: monaco.MarkerSeverity.Hint,
}

export function toMonacoMarker(d: Diagnostic): monaco.editor.IMarkerData {
  const range = toMonacoRange(d.range)
  return {
    severity:
      MARKER_SEVERITY[d.severity ?? DiagnosticSeverity.Error] ??
      monaco.MarkerSeverity.Error,
    message: d.message,
    code: d.code === undefined ? undefined : String(d.code),
    source: d.source,
    startLineNumber: range.startLineNumber,
    startColumn: range.startColumn,
    endLineNumber: range.endLineNumber,
    endColumn: range.endColumn,
  }
}

const LSP_SEVERITY: Record<number, DiagnosticSeverity> = {
  [monaco.MarkerSeverity.Error]: DiagnosticSeverity.Error,
  [monaco.MarkerSeverity.Warning]: DiagnosticSeverity.Warning,
  [monaco.MarkerSeverity.Info]: DiagnosticSeverity.Information,
  [monaco.MarkerSeverity.Hint]: DiagnosticSeverity.Hint,
}

/** Monaco marker → LSP diagnostic, for the `codeAction` request context (the
 * server needs the diagnostics under the cursor to offer matching quick-fixes). */
export function toLspDiagnostic(m: monaco.editor.IMarkerData): Diagnostic {
  return {
    range: toLspRange({
      startLineNumber: m.startLineNumber,
      startColumn: m.startColumn,
      endLineNumber: m.endLineNumber,
      endColumn: m.endColumn,
    }),
    severity: LSP_SEVERITY[m.severity] ?? DiagnosticSeverity.Error,
    code: typeof m.code === 'object' ? m.code.value : m.code,
    source: m.source,
    message: m.message,
  }
}

export function toMonacoLocationList(
  result: LspLocation[] | null,
): monaco.languages.Location[] {
  if (!result) return []
  return result.map((loc) => ({
    uri: monaco.Uri.parse(loc.uri),
    range: toMonacoRange(loc.range),
  }))
}

export function toMonacoWorkspaceEdit(
  edit: LspWorkspaceEdit | null,
): monaco.languages.WorkspaceEdit {
  const edits: monaco.languages.IWorkspaceTextEdit[] = []
  const fileEdits: monaco.languages.IWorkspaceFileEdit[] = []
  if (!edit) return { edits }

  const pushTextEdits = (uri: string, tes: LspTextEdit[]) => {
    for (const te of tes) {
      edits.push({
        resource: monaco.Uri.parse(uri),
        versionId: undefined,
        textEdit: { range: toMonacoRange(te.range), text: te.newText },
      })
    }
  }

  if (edit.changes) {
    for (const [uri, tes] of Object.entries(edit.changes)) pushTextEdits(uri, tes)
  }
  if (edit.documentChanges) {
    for (const dc of edit.documentChanges) {
      if ('textDocument' in dc) {
        pushTextEdits(dc.textDocument.uri, dc.edits as LspTextEdit[])
      } else if (dc.kind === 'create') {
        fileEdits.push({ newResource: monaco.Uri.parse(dc.uri) })
      } else if (dc.kind === 'rename') {
        fileEdits.push({
          oldResource: monaco.Uri.parse(dc.oldUri),
          newResource: monaco.Uri.parse(dc.newUri),
        })
      } else if (dc.kind === 'delete') {
        fileEdits.push({ oldResource: monaco.Uri.parse(dc.uri) })
      }
    }
  }
  return { edits: [...fileEdits, ...edits] }
}

const SYMBOL_KIND: Record<number, monaco.languages.SymbolKind> = {
  [LspSymbolKind.File]: monaco.languages.SymbolKind.File,
  [LspSymbolKind.Module]: monaco.languages.SymbolKind.Module,
  [LspSymbolKind.Namespace]: monaco.languages.SymbolKind.Namespace,
  [LspSymbolKind.Package]: monaco.languages.SymbolKind.Package,
  [LspSymbolKind.Class]: monaco.languages.SymbolKind.Class,
  [LspSymbolKind.Method]: monaco.languages.SymbolKind.Method,
  [LspSymbolKind.Property]: monaco.languages.SymbolKind.Property,
  [LspSymbolKind.Field]: monaco.languages.SymbolKind.Field,
  [LspSymbolKind.Constructor]: monaco.languages.SymbolKind.Constructor,
  [LspSymbolKind.Enum]: monaco.languages.SymbolKind.Enum,
  [LspSymbolKind.Interface]: monaco.languages.SymbolKind.Interface,
  [LspSymbolKind.Function]: monaco.languages.SymbolKind.Function,
  [LspSymbolKind.Variable]: monaco.languages.SymbolKind.Variable,
  [LspSymbolKind.Constant]: monaco.languages.SymbolKind.Constant,
  [LspSymbolKind.String]: monaco.languages.SymbolKind.String,
  [LspSymbolKind.Number]: monaco.languages.SymbolKind.Number,
  [LspSymbolKind.Boolean]: monaco.languages.SymbolKind.Boolean,
  [LspSymbolKind.Array]: monaco.languages.SymbolKind.Array,
  [LspSymbolKind.Object]: monaco.languages.SymbolKind.Object,
  [LspSymbolKind.Key]: monaco.languages.SymbolKind.Key,
  [LspSymbolKind.Null]: monaco.languages.SymbolKind.Null,
  [LspSymbolKind.EnumMember]: monaco.languages.SymbolKind.EnumMember,
  [LspSymbolKind.Struct]: monaco.languages.SymbolKind.Struct,
  [LspSymbolKind.Event]: monaco.languages.SymbolKind.Event,
  [LspSymbolKind.Operator]: monaco.languages.SymbolKind.Operator,
  [LspSymbolKind.TypeParameter]: monaco.languages.SymbolKind.TypeParameter,
}

function symbolTags(
  tags: readonly LspSymbolTag[] | undefined,
  deprecated?: boolean,
): monaco.languages.SymbolTag[] {
  return tags?.includes(LspSymbolTag.Deprecated) || deprecated
    ? [monaco.languages.SymbolTag.Deprecated]
    : []
}

function isDocumentSymbolArray(
  arr: DocumentSymbol[] | SymbolInformation[],
): arr is DocumentSymbol[] {
  return arr.length === 0 || 'selectionRange' in arr[0]
}

export function toMonacoSymbols(
  result: DocumentSymbol[] | SymbolInformation[] | null,
): monaco.languages.DocumentSymbol[] {
  if (!result) return []
  if (isDocumentSymbolArray(result)) {
    const map = (s: DocumentSymbol): monaco.languages.DocumentSymbol => ({
      name: s.name,
      detail: s.detail ?? '',
      kind: SYMBOL_KIND[s.kind] ?? monaco.languages.SymbolKind.Variable,
      tags: symbolTags(s.tags, s.deprecated),
      range: toMonacoRange(s.range),
      selectionRange: toMonacoRange(s.selectionRange),
      children: s.children?.map(map),
    })
    return result.map(map)
  }
  // Flat SymbolInformation list (older servers).
  return result.map((s) => ({
    name: s.name,
    detail: s.containerName ?? '',
    kind: SYMBOL_KIND[s.kind] ?? monaco.languages.SymbolKind.Variable,
    tags: symbolTags(s.tags, s.deprecated),
    range: toMonacoRange(s.location.range),
    selectionRange: toMonacoRange(s.location.range),
  }))
}

function toParameterLabel(
  label: string | [number, number],
): string | [number, number] {
  return label
}

function toMonacoParameter(
  p: ParameterInformation,
): monaco.languages.ParameterInformation {
  return {
    label: toParameterLabel(p.label),
    documentation: toMarkdown(p.documentation),
  }
}

function toMonacoSignature(
  s: SignatureInformation,
): monaco.languages.SignatureInformation {
  return {
    label: s.label,
    documentation: toMarkdown(s.documentation),
    parameters: (s.parameters ?? []).map(toMonacoParameter),
    activeParameter: s.activeParameter,
  }
}

export function toMonacoSignatureHelp(
  help: SignatureHelp | null,
): monaco.languages.SignatureHelpResult | null {
  if (!help) return null
  return {
    value: {
      signatures: help.signatures.map(toMonacoSignature),
      activeSignature: help.activeSignature ?? 0,
      activeParameter: help.activeParameter ?? 0,
    },
    dispose() {},
  }
}

export function toMonacoCodeActions(
  result: (LspCommand | LspCodeAction)[] | null,
): monaco.languages.CodeActionList {
  const actions: monaco.languages.CodeAction[] = []
  for (const item of result ?? []) {
    if ('command' in item && typeof item.command === 'string') {
      // A bare Command — no edit we can apply without a registered handler, so
      // surface it as a titled action without an edit (selecting it is a no-op
      // until commands are wired, but it keeps parity with the server's list).
      actions.push({ title: item.title, kind: undefined })
      continue
    }
    const ca = item as LspCodeAction
    actions.push({
      title: ca.title,
      kind: ca.kind,
      isPreferred: ca.isPreferred,
      diagnostics: ca.diagnostics?.map(toMonacoMarker),
      edit: ca.edit ? toMonacoWorkspaceEdit(ca.edit) : undefined,
      disabled: ca.disabled?.reason,
    })
  }
  return { actions, dispose() {} }
}
