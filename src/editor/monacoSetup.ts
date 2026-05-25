import * as monaco from 'monaco-editor'
import editorWorker from 'monaco-editor/esm/vs/editor/editor.worker?worker'
import jsonWorker from 'monaco-editor/esm/vs/language/json/json.worker?worker'
import cssWorker from 'monaco-editor/esm/vs/language/css/css.worker?worker'
import htmlWorker from 'monaco-editor/esm/vs/language/html/html.worker?worker'
import tsWorker from 'monaco-editor/esm/vs/language/typescript/ts.worker?worker'

/** GitHub-dark mono stack — mirrors `--font-mono` in tokens.css. Passed as a
 * literal because Monaco measures glyph widths and can't resolve a CSS var. */
export const EDITOR_FONT_FAMILY =
  "ui-monospace, 'SF Mono', 'SFMono-Regular', Menlo, Monaco, 'Cascadia Code', " +
  "'Roboto Mono', Consolas, 'Liberation Mono', 'DejaVu Sans Mono', monospace"

export const EDITOR_THEME = 'meecode-dark'

let initialized = false

/**
 * One-time Monaco bootstrap: wires the web workers (bundled locally rather
 * than loaded from a CDN, so editing works offline in the desktop app) and
 * registers the app-matched dark theme. Idempotent — only the first call runs.
 */
export function setupMonaco(): void {
  if (initialized) return
  initialized = true

  self.MonacoEnvironment = {
    getWorker(_workerId, label) {
      switch (label) {
        case 'json':
          return new jsonWorker()
        case 'css':
        case 'scss':
        case 'less':
          return new cssWorker()
        case 'html':
        case 'handlebars':
        case 'razor':
          return new htmlWorker()
        case 'typescript':
        case 'javascript':
          return new tsWorker()
        default:
          return new editorWorker()
      }
    },
  }

  // Match the app shell (GitHub-dark palette in tokens.css) so the editing
  // surface doesn't visually detach from the panel chrome around it.
  monaco.editor.defineTheme(EDITOR_THEME, {
    base: 'vs-dark',
    inherit: true,
    rules: [],
    colors: {
      'editor.background': '#0d1117',
      'editor.foreground': '#c9d1d9',
      'editorLineNumber.foreground': '#6e7681',
      'editorLineNumber.activeForeground': '#c9d1d9',
      'editor.selectionBackground': '#1f3a5f',
      'editor.lineHighlightBackground': '#161b22',
      'editorCursor.foreground': '#58a6ff',
      'editorWidget.background': '#161b22',
      'editorWidget.border': '#30363d',
      'editorIndentGuide.background': '#21262d',
      'editorIndentGuide.activeBackground': '#30363d',
    },
  })
}
