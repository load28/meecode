import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import { DetachedFileWindow } from './components/DetachedFileWindow'
import './styles/tokens.css'
import { bootstrapSessionListeners } from './state/sessionStore'
import { bootstrapOrganizeListeners } from './state/organizeStore'
import { bootstrapHarvestListeners } from './state/harvestStore'
import {
  bootstrapLanguagePlugins,
  bootstrapLspRecovery,
} from './editor/plugins/registry'
import { registerEditorOpener } from './editor/navigation'

const params = new URLSearchParams(window.location.search)
const view = params.get('view')

// Language plugins are declared in both the main and detached (code) windows so
// an enabled grammar/server lights up wherever a file is shown.
bootstrapLanguagePlugins()
// Respawn language servers that crash (bounded), VS Code-style.
bootstrapLspRecovery()
// Route cross-file definition/reference jumps into the file-tab system.
registerEditorOpener()

// The detached code window is a stripped-down satellite — no session state,
// no chat, no PTY. Skip the session listener bootstrap so this window doesn't
// double-subscribe to backend events (those belong to the main window).
if (view !== 'file-panel') {
  bootstrapSessionListeners()
  bootstrapOrganizeListeners()
  bootstrapHarvestListeners()
}

window.addEventListener('unhandledrejection', (e) => {
  const reason = e.reason as { message?: string; stack?: string } | undefined
  if (reason?.message?.includes('handlerId')) {
    console.group('[meecode] Tauri listener teardown race')
    console.warn('message:', reason.message)
    console.warn('stack:', reason.stack)
    console.groupEnd()
    e.preventDefault()
  }
})

const Root = view === 'file-panel' ? <DetachedFileWindow /> : <App />

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>{Root}</React.StrictMode>,
)
