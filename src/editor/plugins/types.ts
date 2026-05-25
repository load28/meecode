import type * as monaco from 'monaco-editor'

/** Language-server contribution. The server runs out-of-process (Tauri sidecar)
 * and is connected over LSP — mirroring how a VS Code extension contributes a
 * server via the language client. */
export interface LspContribution {
  /** Program to spawn: an absolute path or a name resolved on PATH. */
  command: string
  args?: string[]
  /** Passed as LSP `initializationOptions`. */
  initializationOptions?: unknown
}

/** A grammar contribution, loaded lazily on activation (not bundled upfront). */
export interface GrammarContribution {
  scopeName: string
  load: () => Promise<{ content: string; format?: 'json' | 'plist' }>
}

/**
 * A language plugin — the unit a user installs/enables on demand. Mirrors VS
 * Code's split between declarative "language basics" (id/extensions, grammar,
 * configuration) and programmatic "smartness" (an LSP server). Everything past
 * the declarative metadata is loaded only when the plugin activates.
 */
export interface LanguagePlugin {
  /** Monaco language id, e.g. 'toml'. */
  id: string
  /** Human label for the settings UI. */
  label: string
  extensions?: string[]
  filenames?: string[]
  aliases?: string[]
  /** TextMate grammar for VS Code-grade highlighting. */
  grammar?: GrammarContribution
  /** Brackets / comments / auto-closing pairs. */
  configuration?: () => Promise<monaco.languages.LanguageConfiguration>
  /** Language server for completion / hover / diagnostics / definitions. */
  lsp?: LspContribution
}

export interface PluginStatus {
  plugin: LanguagePlugin
  enabled: boolean
  active: boolean
}
