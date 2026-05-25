import { emitTo } from '@tauri-apps/api/event'
import { getCurrentWebviewWindow } from '@tauri-apps/api/webviewWindow'
import { useFileTabs } from '../../hooks/useFileTabs'
import type { CodeSnippet } from '../../types/composer'
import { LOADING } from '../../utils/messages'
import { FilePanel } from '../FilePanel'
import {
  useDetachedFileEvents,
  DETACHED_MAIN_LABEL,
} from './useDetachedFileEvents'
import './DetachedFileWindow.css'

export function DetachedFileWindow() {
  // Its own isolated view scope — this is a separate webview window, so its
  // tabViewStore is a distinct module instance and the id never collides with
  // a main-window tab.
  const fileTabs = useFileTabs('detached')
  const { hydrated } = useDetachedFileEvents(fileTabs)

  const handleAddSnippet = (snippet: CodeSnippet) => {
    void emitTo(DETACHED_MAIN_LABEL, 'composer:add-context', snippet)
  }

  const handleDock = async () => {
    // window.close()는 useDetachedFileEvents의 onCloseRequested 훅을 트리거 —
    // 거기서 탭 스냅샷을 main에 dock 이벤트로 보내고 그 다음 destroy한다.
    const w = getCurrentWebviewWindow()
    await w.close()
  }

  return (
    <div className="detached-file-window">
      {!hydrated && fileTabs.tabs.length === 0 && (
        <div className="detached-file-window__loading">{LOADING}</div>
      )}
      <FilePanel
        tabs={fileTabs.tabs}
        activePath={fileTabs.activePath}
        onSelect={fileTabs.setActive}
        onClose={fileTabs.close}
        onCloseAll={fileTabs.closeAll}
        onSetViewMode={fileTabs.setViewMode}
        onSetMarkdownView={fileTabs.setMarkdownView}
        onSyncTab={fileTabs.syncDisk}
        onAddSelectionToComposer={handleAddSnippet}
        onDock={handleDock}
      />
    </div>
  )
}
