import { useCallback, useSyncExternalStore } from 'react'
import * as monaco from 'monaco-editor'
import { listen } from '../../platform/ipc'
import { provideGrammar } from '../textmate/registry'
import { wireTextMate } from '../textmate/tokensProvider'
import { BUILTIN_PLUGINS } from './catalog'
import type { LanguagePlugin, PluginStatus } from './types'

const ENABLED_KEY = 'meecode.languagePlugins.enabled'

const installed = new Map<string, LanguagePlugin>()
const active = new Set<string>()
const disposables = new Map<string, monaco.IDisposable[]>()
const listeners = new Set<() => void>()

function loadEnabled(): Set<string> {
  try {
    const raw = localStorage.getItem(ENABLED_KEY)
    if (raw) return new Set(JSON.parse(raw) as string[])
  } catch {
    /* ignore malformed storage */
  }
  return new Set()
}

const enabledIds = loadEnabled()

function saveEnabled(): void {
  try {
    localStorage.setItem(ENABLED_KEY, JSON.stringify([...enabledIds]))
  } catch {
    /* ignore quota / private-mode errors */
  }
}

/** Whether a plugin is enabled — read by the Language Host to decide whether to
 * spawn a server. Shared across windows via the same localStorage origin. */
export function isPluginEnabled(id: string): boolean {
  return enabledIds.has(id)
}

// Cached snapshot so useSyncExternalStore sees a stable reference between
// changes (rebuilt only when something actually changes).
let snapshot: PluginStatus[] = []

function rebuildSnapshot(): void {
  snapshot = [...installed.values()].map((plugin) => ({
    plugin,
    enabled: enabledIds.has(plugin.id),
    active: active.has(plugin.id),
  }))
}

function emit(): void {
  rebuildSnapshot()
  for (const cb of listeners) cb()
}

/** Register a plugin's declarative metadata with Monaco (cheap — no grammar or
 * server is loaded until the plugin activates). */
export function registerPlugin(plugin: LanguagePlugin): void {
  if (installed.has(plugin.id)) return
  installed.set(plugin.id, plugin)
  monaco.languages.register({
    id: plugin.id,
    extensions: plugin.extensions,
    filenames: plugin.filenames,
    aliases: plugin.aliases ?? [plugin.label, plugin.id],
  })
  emit()
}

/** Register every built-in plugin. Call once per window at startup. */
export function bootstrapLanguagePlugins(): void {
  for (const plugin of BUILTIN_PLUGINS) registerPlugin(plugin)
}

async function activate(id: string): Promise<void> {
  const plugin = installed.get(id)
  if (!plugin || active.has(id) || !enabledIds.has(id)) return
  active.add(id) // set before awaits to prevent re-entrant activation
  const ds: monaco.IDisposable[] = []
  try {
    if (plugin.configuration) {
      const cfg = await plugin.configuration()
      ds.push(monaco.languages.setLanguageConfiguration(plugin.id, cfg))
    }
    if (plugin.grammar) {
      const g = await plugin.grammar.load()
      provideGrammar(plugin.id, {
        scopeName: plugin.grammar.scopeName,
        content: g.content,
        format: g.format,
      })
      const tm = await wireTextMate(plugin.id)
      if (tm) ds.push(tm)
    }
    if (plugin.lsp) {
      // Lazy: the LSP client + protocol stack loads only when a server-backed
      // plugin activates, keeping it out of startup. One client per language in
      // the single renderer (auxiliary windows share Monaco's registry).
      const { startLanguageClient } = await import('../lsp/client')
      ds.push(await startLanguageClient(plugin.id, plugin.lsp))
    }
  } catch (e) {
    console.error(`[plugins] failed to activate "${id}"`, e)
  }
  disposables.set(id, ds)
  emit()
}

function deactivate(id: string): void {
  active.delete(id)
  const ds = disposables.get(id)
  if (ds) {
    for (const d of ds) d.dispose()
    disposables.delete(id)
  }
  emit()
}

/**
 * Activation trigger (VS Code's `onLanguage:<id>`): when a model of `languageId`
 * is opened, activate the matching enabled plugin if it hasn't started yet.
 */
export function ensureLanguageActivated(languageId: string): void {
  if (
    installed.has(languageId) &&
    enabledIds.has(languageId) &&
    !active.has(languageId)
  ) {
    void activate(languageId)
  }
}

export function setPluginEnabled(id: string, on: boolean): void {
  if (on === enabledIds.has(id)) return
  if (on) {
    enabledIds.add(id)
    saveEnabled()
    void activate(id)
  } else {
    enabledIds.delete(id)
    saveEnabled()
    deactivate(id)
  }
  emit()
}

// Bounded crash recovery: how many times we'll respawn a server that keeps
// exiting before giving up (VS Code restarts a crashed server a few times too).
const restarts = new Map<string, number>()
const MAX_RESTARTS = 4

/**
 * React to a language server process exiting (`lsp:exit` from the backend).
 * The dead client is torn down and, if the plugin is still enabled and hasn't
 * exhausted its restart budget, respawned. Call once at startup.
 */
export function bootstrapLspRecovery(): void {
  void listen<{ id: string }>('lsp:exit', (e) => {
    const id = e.payload.id
    const languageId = id.startsWith('lsp-') ? id.slice(4) : id
    if (!active.has(languageId)) return
    deactivate(languageId)
    const n = restarts.get(languageId) ?? 0
    if (!enabledIds.has(languageId) || n >= MAX_RESTARTS) return
    restarts.set(languageId, n + 1)
    void activate(languageId)
  })
}

export function listPluginStatuses(): PluginStatus[] {
  return snapshot
}

/** Reactive plugin list for the settings UI. */
export function usePluginStatuses(): PluginStatus[] {
  const subscribe = useCallback((cb: () => void) => {
    listeners.add(cb)
    return () => {
      listeners.delete(cb)
    }
  }, [])
  return useSyncExternalStore(subscribe, listPluginStatuses, listPluginStatuses)
}
