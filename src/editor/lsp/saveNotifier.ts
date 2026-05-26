/**
 * A tiny "document was saved" signal. `useFileSave` fires it after a successful
 * write; active language clients subscribe to send LSP `textDocument/didSave`
 * (servers like gopls / rust-analyzer run work on save). Kept dependency-light
 * so importing it from the save hook never pulls the LSP client bundle.
 */
type SaveListener = (path: string) => void

const listeners = new Set<SaveListener>()

export function onDocumentSaved(cb: SaveListener): () => void {
  listeners.add(cb)
  return () => {
    listeners.delete(cb)
  }
}

export function notifyDocumentSaved(path: string): void {
  for (const cb of listeners) cb(path)
}
