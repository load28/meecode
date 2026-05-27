import { describe, expect, it } from 'vitest'
import * as monaco from 'monaco-editor'
import {
  CompletionItemKind,
  InsertTextFormat,
  SymbolKind,
  type CompletionItem,
  type DocumentSymbol,
  type SignatureHelp,
  type SymbolInformation,
  type WorkspaceEdit,
} from 'vscode-languageserver-protocol'
import {
  mergeResolvedCompletion,
  toLspRange,
  toMonacoCodeActions,
  toMonacoCompletion,
  toMonacoRange,
  toMonacoSignatureHelp,
  toMonacoSymbols,
  toMonacoWorkspaceEdit,
  type MonacoCompletionItem,
} from './convert'

const FALLBACK: monaco.IRange = {
  startLineNumber: 1,
  startColumn: 1,
  endLineNumber: 1,
  endColumn: 1,
}

describe('range conversion', () => {
  it('round-trips between 0-based LSP and 1-based Monaco', () => {
    const lsp = { start: { line: 4, character: 2 }, end: { line: 4, character: 9 } }
    const m = toMonacoRange(lsp)
    expect(m).toEqual({
      startLineNumber: 5,
      startColumn: 3,
      endLineNumber: 5,
      endColumn: 10,
    })
    expect(toLspRange(m)).toEqual(lsp)
  })
})

describe('completion', () => {
  it('carries additionalTextEdits (auto-import) and stashes the LSP item', () => {
    const item: CompletionItem = {
      label: 'useState',
      kind: CompletionItemKind.Function,
      insertTextFormat: InsertTextFormat.Snippet,
      insertText: 'useState($0)',
      additionalTextEdits: [
        {
          range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } },
          newText: "import { useState } from 'react'\n",
        },
      ],
    }
    const m = toMonacoCompletion(item, FALLBACK)
    expect(m.insertTextRules).toBe(
      monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
    )
    expect(m.additionalTextEdits).toHaveLength(1)
    expect(m.additionalTextEdits![0].text).toContain('import')
    expect((m as MonacoCompletionItem).__lsp).toBe(item)
  })

  it('merges a resolved item without losing the shown range', () => {
    const shown = toMonacoCompletion(
      { label: 'foo', kind: CompletionItemKind.Field },
      FALLBACK,
    )
    const resolved: CompletionItem = {
      label: 'foo',
      detail: 'number',
      additionalTextEdits: [
        {
          range: { start: { line: 2, character: 0 }, end: { line: 2, character: 0 } },
          newText: 'x',
        },
      ],
    }
    const merged = mergeResolvedCompletion(shown, resolved)
    expect(merged.detail).toBe('number')
    expect(merged.additionalTextEdits).toHaveLength(1)
    expect(merged.range).toEqual(shown.range)
  })
})

describe('workspace edit', () => {
  it('flattens `changes` into per-resource text edits', () => {
    const edit: WorkspaceEdit = {
      changes: {
        'file:///a.ts': [
          {
            range: { start: { line: 0, character: 0 }, end: { line: 0, character: 3 } },
            newText: 'bar',
          },
        ],
      },
    }
    const m = toMonacoWorkspaceEdit(edit)
    expect(m.edits).toHaveLength(1)
    const te = m.edits[0] as monaco.languages.IWorkspaceTextEdit
    expect(te.resource.path).toBe('/a.ts')
    expect(te.textEdit.text).toBe('bar')
  })

  it('handles documentChanges with a rename file op', () => {
    const edit: WorkspaceEdit = {
      documentChanges: [
        { kind: 'rename', oldUri: 'file:///old.ts', newUri: 'file:///new.ts' },
        {
          textDocument: { uri: 'file:///new.ts', version: 1 },
          edits: [
            {
              range: { start: { line: 1, character: 0 }, end: { line: 1, character: 0 } },
              newText: 'x',
            },
          ],
        },
      ],
    }
    const m = toMonacoWorkspaceEdit(edit)
    // File ops come first so the rename lands before edits to the new path.
    const fileEdit = m.edits[0] as monaco.languages.IWorkspaceFileEdit
    expect(fileEdit.oldResource?.path).toBe('/old.ts')
    expect(fileEdit.newResource?.path).toBe('/new.ts')
  })
})

describe('document symbols', () => {
  it('maps hierarchical DocumentSymbols with children and kinds', () => {
    const syms: DocumentSymbol[] = [
      {
        name: 'Foo',
        kind: SymbolKind.Class,
        range: { start: { line: 0, character: 0 }, end: { line: 9, character: 0 } },
        selectionRange: { start: { line: 0, character: 6 }, end: { line: 0, character: 9 } },
        children: [
          {
            name: 'bar',
            kind: SymbolKind.Method,
            range: { start: { line: 1, character: 2 }, end: { line: 3, character: 0 } },
            selectionRange: { start: { line: 1, character: 2 }, end: { line: 1, character: 5 } },
          },
        ],
      },
    ]
    const m = toMonacoSymbols(syms)
    expect(m[0].kind).toBe(monaco.languages.SymbolKind.Class)
    expect(m[0].children?.[0].kind).toBe(monaco.languages.SymbolKind.Method)
    expect(m[0].range.startLineNumber).toBe(1)
  })

  it('flattens legacy SymbolInformation', () => {
    const syms: SymbolInformation[] = [
      {
        name: 'g',
        kind: SymbolKind.Function,
        location: {
          uri: 'file:///a.ts',
          range: { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } },
        },
      },
    ]
    const m = toMonacoSymbols(syms)
    expect(m).toHaveLength(1)
    expect(m[0].kind).toBe(monaco.languages.SymbolKind.Function)
  })
})

describe('signature help & code actions', () => {
  it('defaults active indices and disposes cleanly', () => {
    const help: SignatureHelp = {
      signatures: [{ label: 'f(a: number)', parameters: [{ label: 'a: number' }] }],
    }
    const m = toMonacoSignatureHelp(help)
    expect(m).not.toBeNull()
    expect(m!.value.activeSignature).toBe(0)
    expect(m!.value.signatures[0].parameters).toHaveLength(1)
    expect(() => m!.dispose()).not.toThrow()
  })

  it('converts a code action with a workspace edit', () => {
    const list = toMonacoCodeActions([
      {
        title: 'Add import',
        kind: 'quickfix',
        isPreferred: true,
        edit: {
          changes: {
            'file:///a.ts': [
              {
                range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } },
                newText: 'import x\n',
              },
            ],
          },
        },
      },
    ])
    expect(list.actions).toHaveLength(1)
    expect(list.actions[0].title).toBe('Add import')
    expect(list.actions[0].isPreferred).toBe(true)
    expect(list.actions[0].edit?.edits).toHaveLength(1)
  })
})
