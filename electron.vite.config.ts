import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'

// M0/M0.5 spike config. Self-contained under electron/ — does not touch the
// existing Tauri app (src/). Renderer is a minimal spike page, not the real app
// (that wiring comes in M1/M2 once the IPC seam is swapped).
export default defineConfig({
  main: {
    build: {
      outDir: 'out/main',
      lib: { entry: 'electron/main/index.ts' },
      rollupOptions: { external: ['electron'] },
    },
  },
  preload: {
    build: {
      outDir: 'out/preload',
      lib: { entry: 'electron/preload/index.ts' },
      rollupOptions: { external: ['electron'] },
    },
  },
  renderer: {
    root: 'electron/renderer',
    plugins: [react()],
    build: {
      outDir: 'out/renderer',
      rollupOptions: { input: 'electron/renderer/index.html' },
    },
  },
})
