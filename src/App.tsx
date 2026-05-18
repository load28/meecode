import { useState } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { open } from '@tauri-apps/plugin-dialog'
import { Panel, PanelGroup, PanelResizeHandle } from 'react-resizable-panels'
import { TerminalPane } from './components/TerminalPane'
import { MarkdownPane } from './components/MarkdownPane'
import { usePtyStream } from './hooks/usePtyStream'
import './App.css'

function FolderPicker({ onStart }: { onStart: (path: string) => void }) {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const handleSelect = async () => {
    const selected = await open({ directory: true, multiple: false })
    if (!selected || typeof selected !== 'string') return

    setLoading(true)
    setError('')
    try {
      await invoke('start_session', { path: selected })
      onStart(selected)
    } catch (e) {
      setError(String(e))
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="folder-picker">
      <div className="folder-picker__card">
        <div className="folder-picker__logo">M</div>
        <h1 className="folder-picker__title">MeeCode</h1>
        <p className="folder-picker__desc">
          프로젝트 폴더를 선택하면 Claude Code가 해당 디렉토리에서 실행됩니다.
        </p>
        <button
          className="folder-picker__btn"
          onClick={handleSelect}
          disabled={loading}
        >
          {loading ? '시작 중...' : '📂 프로젝트 폴더 선택'}
        </button>
        {error && <p className="folder-picker__error">{error}</p>}
      </div>
    </div>
  )
}

function MainLayout({ projectPath }: { projectPath: string }) {
  const { pairs, selectedId, isVisible, selectPair } = usePtyStream()

  return (
    <div className="app">
      <div className="app__header">
        <span className="app__path">{projectPath}</span>
      </div>
      <div className="app__body">
        <PanelGroup direction="horizontal">
          <Panel defaultSize={50} minSize={20}>
            <TerminalPane />
          </Panel>
          <PanelResizeHandle
            className="resize-handle"
            style={{ display: isVisible ? undefined : 'none' }}
          />
          <Panel
            defaultSize={50}
            minSize={20}
            style={{ display: isVisible ? undefined : 'none' }}
          >
            <MarkdownPane
              pairs={pairs}
              selectedId={selectedId}
              onSelect={selectPair}
              isVisible={isVisible}
            />
          </Panel>
        </PanelGroup>
      </div>
    </div>
  )
}

function App() {
  const [projectPath, setProjectPath] = useState<string | null>(null)

  if (!projectPath) {
    return <FolderPicker onStart={setProjectPath} />
  }

  return <MainLayout projectPath={projectPath} />
}

export default App
