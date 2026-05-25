import * as monaco from 'monaco-editor'
import {
  CompletionItemKind as LspCompletionItemKind,
  DiagnosticSeverity,
  InsertTextFormat,
  type CompletionItem as LspCompletionItem,
  type Diagnostic,
  type Definition,
  type DefinitionLink,
  type Hover,
  type MarkupContent,
  type Position as LspPosition,
  type Range as LspRange,
} from 'vscode-languageserver-protocol'

// LSP positions are 0-based; Monaco's are 1-based.
export function toLspPosition(p: monaco.Position): LspPosition {
  return { line: p.lineNumber - 1, character: p.column - 1 }
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

export function toMonacoCompletion(
  item: LspCompletionItem,
  fallbackRange: monaco.IRange,
): monaco.languages.CompletionItem {
  const edit = item.textEdit
  const range =
    edit && 'range' in edit ? toMonacoRange(edit.range) : fallbackRange
  const insertText = edit?.newText ?? item.insertText ?? item.label
  const isSnippet = item.insertTextFormat === InsertTextFormat.Snippet
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
