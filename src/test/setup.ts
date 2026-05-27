import '@testing-library/jest-dom'
import { vi } from 'vitest'

global.ResizeObserver = vi.fn().mockImplementation(() => ({
  observe: vi.fn(),
  unobserve: vi.fn(),
  disconnect: vi.fn(),
}))

// Shims for APIs jsdom omits but monaco-editor touches at import time.
if (typeof document !== 'undefined' && !('queryCommandSupported' in document)) {
  Object.defineProperty(document, 'queryCommandSupported', {
    value: () => false,
    configurable: true,
  })
}
if (typeof window !== 'undefined' && !window.matchMedia) {
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  }))
}

vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn(() => Promise.resolve(() => {})),
}))

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(() => Promise.resolve()),
}))

// The renderer now talks to the backend through `window.meecode` (the Electron
// preload bridge). Back it with the same Tauri mocks so existing assertions
// (`expect(invokeMock)…`) keep working through the `platform/ipc` seam.
import { invoke as invokeMock } from '@tauri-apps/api/core'
import { listen as listenMock } from '@tauri-apps/api/event'

;(window as unknown as { meecode: unknown }).meecode = {
  invoke: (cmd: string, args?: unknown) =>
    (invokeMock as unknown as (c: string, a?: unknown) => Promise<unknown>)(cmd, args),
  on: (channel: string, cb: (payload: unknown) => void) => {
    void (listenMock as unknown as (c: string, h: (e: { payload: unknown }) => void) => Promise<unknown>)(
      channel,
      (e) => cb(e?.payload),
    )
    return () => {}
  },
  dialogOpen: vi.fn(() => Promise.resolve(null)),
  openExternal: vi.fn(() => Promise.resolve()),
}
