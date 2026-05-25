import * as monaco from 'monaco-editor'
import type { FileTab } from '../hooks/useFileTabs'

/**
 * Maps our backend language labels (see `detect_language` in commands.rs) to
 * Monaco's language ids. Labels that already equal a Monaco id (typescript,
 * javascript, json, css, scss, python, go, java, ...) pass through unchanged.
 */
const LANGUAGE_MAP: Record<string, string> = {
  markup: 'html',
  tsx: 'typescript',
  jsx: 'javascript',
  bash: 'shell',
}

export function toMonacoLanguage(label: string): string {
  return LANGUAGE_MAP[label] ?? label
}

/**
 * The model URI for a tab. Real files use `file://` (so language detection and
 * any future LSP integration key off the real path); virtual tabs (task
 * sources / wiki) get a synthetic `inmemory://` URI and never touch disk.
 */
export function modelUriFor(tab: FileTab): monaco.Uri {
  return tab.virtual
    ? monaco.Uri.parse(`inmemory:///${encodeURIComponent(tab.path)}`)
    : monaco.Uri.file(tab.path)
}

/**
 * One `ITextModel` per URI, reused across tab switches (Monaco enforces
 * uniqueness per URI). Created from the tab's loaded content on first use;
 * later switches return the same model so unsaved edits survive.
 */
export function getOrCreateModel(tab: FileTab): monaco.editor.ITextModel {
  const uri = modelUriFor(tab)
  const existing = monaco.editor.getModel(uri)
  if (existing) return existing
  return monaco.editor.createModel(
    tab.content,
    toMonacoLanguage(tab.language),
    uri,
  )
}

export function getModelForPath(uri: monaco.Uri): monaco.editor.ITextModel | null {
  return monaco.editor.getModel(uri)
}

// Per-path editor view state (cursor, scroll, folding), saved on tab switch
// and restored when the file is shown again — VS Code's per-input memento.
const viewStates = new Map<string, monaco.editor.ICodeEditorViewState | null>()

export function saveViewState(
  path: string,
  state: monaco.editor.ICodeEditorViewState | null,
): void {
  viewStates.set(path, state)
}

export function takeViewState(
  path: string,
): monaco.editor.ICodeEditorViewState | null {
  return viewStates.get(path) ?? null
}
