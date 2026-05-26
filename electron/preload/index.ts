import { contextBridge, ipcRenderer } from 'electron'

// Minimal, secure bridge (contextIsolation on). In the real migration this is
// the single surface the renderer's `src/platform/ipc.ts` seam binds to.
contextBridge.exposeInMainWorld('meecode', {
  invoke: (cmd: string, args?: unknown) => ipcRenderer.invoke('sidecar', { cmd, args }),
  on: (channel: string, cb: (payload: unknown) => void) => {
    const listener = (_e: unknown, payload: unknown) => cb(payload)
    ipcRenderer.on(channel, listener)
    return () => ipcRenderer.removeListener(channel, listener)
  },
  // spike-only: signal main to capture screenshots for verification
  report: (data: unknown) => ipcRenderer.send('spike-report', data),
})
