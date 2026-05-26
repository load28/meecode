import * as monaco from 'monaco-editor'
import type { FileTab } from '../hooks/useFileTabs'
import { isDirty, unregisterWorkingCopy } from '../state/workingCopyStore'

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

// Real files whose content was only partially loaded (a prefix). Tracked so the
// LSP layer can skip them — sending a truncated body would make the server
// diagnose against a file it thinks is complete.
const truncatedPaths = new Set<string>()

export function setTruncated(path: string, isTruncated: boolean): void {
  if (isTruncated) truncatedPaths.add(path)
  else truncatedPaths.delete(path)
}

export function isTruncatedPath(path: string): boolean {
  return truncatedPaths.has(path)
}

// Models pending disposal: closing a tab while its model is still attached to a
// live editor must defer the dispose until the editor swaps away (disposing an
// attached model throws inside Monaco's layout loop). Keyed by path.
const pendingDispose = new Map<string, FileTab>()

function tryRelease(tab: FileTab): boolean {
  const model = monaco.editor.getModel(modelUriFor(tab))
  if (!model) {
    viewStates.delete(tab.path)
    return true
  }
  if (model.isAttachedToEditor()) return false
  // Disposing fires the model's `onWillDispose` (→ LSP `didClose`); also drop
  // our dirty-tracking entry and saved view state so nothing leaks per file.
  unregisterWorkingCopy(tab.path)
  viewStates.delete(tab.path)
  setTruncated(tab.path, false)
  model.dispose()
  return true
}

/**
 * Release a closed tab's Monaco model — VS Code drops a closed editor's model,
 * freeing memory and notifying language servers. Dirty real files are kept
 * alive so unsaved edits survive a reopen (mirrors VS Code's hot-exit). If the
 * model is still on screen, disposal is deferred to the next editor swap.
 */
export function releaseTabModel(tab: FileTab): void {
  if (!tab.virtual && isDirty(tab.path)) return
  if (!tryRelease(tab)) pendingDispose.set(tab.path, tab)
}

/** Dispose any models that were closed while still attached and have since
 * detached. Called after an editor model swap and as a post-close safety net. */
export function flushPendingDisposals(): void {
  for (const [path, tab] of pendingDispose) {
    if (tryRelease(tab)) pendingDispose.delete(path)
  }
}
