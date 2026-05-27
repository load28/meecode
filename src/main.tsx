import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './styles/tokens.css'
import { bootstrapSessionListeners } from './state/sessionStore'
import { bootstrapOrganizeListeners } from './state/organizeStore'
import { bootstrapHarvestListeners } from './state/harvestStore'
import {
  bootstrapLanguagePlugins,
  bootstrapLspRecovery,
} from './editor/plugins/registry'
import { registerEditorOpener } from './editor/navigation'

bootstrapLanguagePlugins()
// Respawn language servers that crash (bounded), VS Code-style.
bootstrapLspRecovery()
// Route cross-file definition/reference jumps into the file-tab system.
registerEditorOpener()
bootstrapSessionListeners()
bootstrapOrganizeListeners()
bootstrapHarvestListeners()

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
