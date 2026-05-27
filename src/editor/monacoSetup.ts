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

// GitHub-dark token colors. Monaco resolves a token's color by the longest
// dot-prefixed rule that matches, so these cover both Monaco's built-in Monarch
// token types and the finer TextMate scopes emitted by language plugins.
const TOKEN_RULES: { token: string; foreground?: string; fontStyle?: string }[] = [
  { token: 'comment', foreground: '8b949e', fontStyle: 'italic' },
  { token: 'string', foreground: 'a5d6ff' },
  { token: 'string.regexp', foreground: '7ee787' },
  { token: 'regexp', foreground: '7ee787' },
  { token: 'constant.character.escape', foreground: '79c0ff' },
  { token: 'keyword', foreground: 'ff7b72' },
  { token: 'keyword.operator', foreground: 'ff7b72' },
  { token: 'storage', foreground: 'ff7b72' },
  { token: 'number', foreground: '79c0ff' },
  { token: 'constant', foreground: '79c0ff' },
  { token: 'constant.numeric', foreground: '79c0ff' },
  { token: 'constant.language', foreground: '79c0ff' },
  { token: 'variable', foreground: 'c9d1d9' },
  { token: 'variable.parameter', foreground: 'ffa657' },
  { token: 'variable.language', foreground: '79c0ff' },
  { token: 'variable.other.key', foreground: '79c0ff' },
  { token: 'type', foreground: 'ffa657' },
  { token: 'entity.name.type', foreground: 'ffa657' },
  { token: 'entity.name.namespace', foreground: 'ffa657' },
  { token: 'entity.name.function', foreground: 'd2a8ff' },
  { token: 'entity.name.section', foreground: 'd2a8ff' },
  { token: 'entity.name.tag', foreground: '7ee787' },
  { token: 'entity.other.attribute-name', foreground: '79c0ff' },
  { token: 'support', foreground: '79c0ff' },
  { token: 'support.function', foreground: 'd2a8ff' },
  { token: 'support.type', foreground: 'ffa657' },
  { token: 'support.class', foreground: 'ffa657' },
  { token: 'invalid', foreground: 'f85149' },
]

/** Scopes the theme has a rule for — used by the TextMate token provider to
 * pick the most specific scope that will actually resolve to a color. */
export const THEME_TOKEN_SCOPES: readonly string[] = TOKEN_RULES.map((r) => r.token)

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
    rules: TOKEN_RULES,
    colors: {
      'editor.background': '#0d1117',
      'editor.foreground': '#c9d1d9',
      'editorLineNumber.foreground': '#6e7681',
      'editorLineNumber.activeForeground': '#c9d1d9',
      'editor.selectionBackground': '#1f3a5f',
      'editor.selectionHighlightBackground': '#1f3a5f80',
      'editor.wordHighlightBackground': '#1f6feb44',
      'editor.wordHighlightStrongBackground': '#1f6feb66',
      'editor.findMatchBackground': '#9e6a03',
      'editor.findMatchHighlightBackground': '#f2cc6044',
      'editor.lineHighlightBackground': '#161b22',
      'editorCursor.foreground': '#58a6ff',
      'editorWidget.background': '#161b22',
      'editorWidget.border': '#30363d',
      'editorSuggestWidget.background': '#161b22',
      'editorSuggestWidget.border': '#30363d',
      'editorSuggestWidget.selectedBackground': '#1f3a5f',
      'editorHoverWidget.background': '#161b22',
      'editorHoverWidget.border': '#30363d',
      'editorIndentGuide.background': '#21262d',
      'editorIndentGuide.activeBackground': '#30363d',
      'editorError.foreground': '#f85149',
      'editorWarning.foreground': '#d29922',
      'editorInfo.foreground': '#58a6ff',
      'editorGutter.modifiedBackground': '#bb800966',
      'editorGutter.addedBackground': '#2ea04366',
      'editorGutter.deletedBackground': '#f8514966',
      'editorBracketMatch.background': '#3fb95040',
      'editorBracketMatch.border': '#3fb95080',
      'editorBracketHighlight.foreground1': '#79c0ff',
      'editorBracketHighlight.foreground2': '#d2a8ff',
      'editorBracketHighlight.foreground3': '#7ee787',
      'editorBracketHighlight.foreground4': '#ffa657',
      'editorBracketHighlight.unexpectedBracket.foreground': '#f85149',
      'editorOverviewRuler.border': '#0d1117',
    },
  })
}
