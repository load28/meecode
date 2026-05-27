import { contextBridge, ipcRenderer } from 'electron'

// The single, contextIsolated surface the renderer's `src/platform/ipc.ts` seam
// binds to — the Electron equivalent of the Tauri `@tauri-apps/api`.
contextBridge.exposeInMainWorld('meecode', {
  invoke: (cmd: string, args?: unknown) => ipcRenderer.invoke('sidecar', { cmd, args }),
  on: (channel: string, cb: (payload: unknown) => void) => {
    const listener = (_e: unknown, payload: unknown) => cb(payload)
    ipcRenderer.on(channel, listener)
    return () => ipcRenderer.removeListener(channel, listener)
  },
  dialogOpen: (options?: unknown) => ipcRenderer.invoke('dialog:open', options),
  openExternal: (url: string) => ipcRenderer.invoke('shell:openExternal', url),
  // spike-only verification hook (no-op in the real app)
  report: (data: unknown) => ipcRenderer.send('spike-report', data),
})
