import {
  loadWASM,
  createOnigScanner,
  createOnigString,
} from 'vscode-oniguruma'
import onigWasmUrl from 'vscode-oniguruma/release/onig.wasm?url'
import type { IOnigLib } from 'vscode-textmate'

let onigLibPromise: Promise<IOnigLib> | null = null

/**
 * Lazily load the Oniguruma regex engine (WASM, bundled locally for offline
 * use) that TextMate grammars require. Resolved once and shared.
 */
export function getOnigLib(): Promise<IOnigLib> {
  if (!onigLibPromise) {
    onigLibPromise = fetch(onigWasmUrl)
      .then((res) => res.arrayBuffer())
      .then((buffer) => loadWASM(buffer))
      .then(() => ({ createOnigScanner, createOnigString }))
  }
  return onigLibPromise
}
