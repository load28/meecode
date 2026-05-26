import * as monaco from 'monaco-editor'

/**
 * Cross-file navigation bridge. Standalone Monaco can only open models it
 * already holds, so a Go-to-Definition / reference / rename result pointing at
 * another file does nothing on its own. We register a global editor opener
 * (VS Code's `IEditorService` hook) that routes such targets into the app's
 * file-tab system, and stash the target range for the editor to reveal once
 * the file is shown.
 */

type OpenHandler = (path: string) => void

let handler: OpenHandler | null = null
const pendingReveal = new Map<string, monaco.IRange>()
let registered = false

/** The active panel registers how to open a path (open tab + focus it). */
export function setEditorOpenHandler(fn: OpenHandler | null): void {
  handler = fn
}

/** The editor pulls (and clears) a pending reveal range for a freshly shown file. */
export function consumePendingReveal(path: string): monaco.IRange | null {
  const r = pendingReveal.get(path)
  if (r) pendingReveal.delete(path)
  return r ?? null
}

function toRange(target: monaco.IRange | monaco.IPosition): monaco.IRange {
  if ('startLineNumber' in target) return target
  return {
    startLineNumber: target.lineNumber,
    startColumn: target.column,
    endLineNumber: target.lineNumber,
    endColumn: target.column,
  }
}

/** Register the global opener once per window. Idempotent. */
export function registerEditorOpener(): void {
  if (registered) return
  registered = true
  monaco.editor.registerEditorOpener({
    openCodeEditor(_source, resource, selectionOrPosition) {
      if (resource.scheme !== 'file' || !handler) return false
      const path = resource.fsPath
      if (selectionOrPosition) pendingReveal.set(path, toRange(selectionOrPosition))
      handler(path)
      return true
    },
  })
}
