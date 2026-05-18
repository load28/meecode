import { useEffect } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { Panel, PanelGroup, PanelResizeHandle } from 'react-resizable-panels'
import { TerminalPane } from './components/TerminalPane'
import { MarkdownPane } from './components/MarkdownPane'
import { usePtyStream } from './hooks/usePtyStream'
import './App.css'

function App() {
  const { markdownContent, isMarkdownVisible } = usePtyStream()

  useEffect(() => {
    invoke('start_session').catch((e) =>
      console.error('Failed to start PTY session:', e)
    )
  }, [])

  return (
    <div className="app">
      <PanelGroup direction="horizontal">
        <Panel defaultSize={50} minSize={20}>
          <TerminalPane />
        </Panel>
        <PanelResizeHandle
          className="resize-handle"
          style={{ display: isMarkdownVisible ? undefined : 'none' }}
        />
        <Panel
          defaultSize={50}
          minSize={20}
          style={{ display: isMarkdownVisible ? undefined : 'none' }}
        >
          <MarkdownPane content={markdownContent} isVisible={isMarkdownVisible} />
        </Panel>
      </PanelGroup>
    </div>
  )
}

export default App
