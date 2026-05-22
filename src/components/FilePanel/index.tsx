import { useMemo } from 'react'
import type {
  FileTab,
  FileViewMode,
  MarkdownView,
} from '../../hooks/useFileTabs'
import { highlight } from './highlight'
import { formatBytes } from './utils'
import { FileTabsBar } from './FileTabsBar'
import { FileBodyViewer } from './FileBodyViewer'
import { useCodeSelection } from './useCodeSelection'
import './FilePanel.css'

interface Props {
  tabs: FileTab[]
  activePath: string | null
  onSelect: (path: string) => void
  onClose: (path: string) => void
  onCloseAll: () => void
  onSetViewMode?: (path: string, mode: FileViewMode) => void
  onSetMarkdownView?: (path: string, view: MarkdownView) => void
  onAddSelectionToComposer: (snippet: {
    text: string
    path: string
    startLine: number
    endLine: number
  }) => void
  // Inline mode passes onDetach (pop into satellite window). The detached
  // window passes onDock (collapse back into main). Exactly one of the two
  // is set per render — they're mutually exclusive states.
  onDetach?: () => void
  onDock?: () => void
}

export function FilePanel({
  tabs,
  activePath,
  onSelect,
  onClose,
  onCloseAll,
  onSetViewMode,
  onSetMarkdownView,
  onAddSelectionToComposer,
  onDetach,
  onDock,
}: Props) {
  const active = useMemo(
    () => tabs.find((t) => t.path === activePath) ?? null,
    [tabs, activePath],
  )

  const {
    selection,
    codeRef,
    handleMouseUp,
    clear: clearSelection,
  } = useCodeSelection(activePath)

  const highlighted = useMemo(() => {
    if (!active) return ''
    return highlight(active.content, active.language)
  }, [active])

  const isMarkdown = active?.language === 'markdown'
  const showingDiff = active?.viewMode === 'diff' && !!active.pending

  const lineCount = useMemo(() => {
    if (!active) return 0
    return active.content.split('\n').length
  }, [active])

  if (tabs.length === 0) {
    return (
      <aside className="file-panel file-panel--empty">
        {onDock && (
          <div className="file-panel__tabs file-panel__tabs--actions-only">
            <button
              type="button"
              className="file-panel__action"
              onClick={onDock}
              title="메인 창으로 도킹"
            >
              ⊟ 도킹
            </button>
          </div>
        )}
        <div className="file-panel__placeholder">
          채팅에서 파일 경로를 클릭하면 여기서 열립니다.
        </div>
      </aside>
    )
  }

  return (
    <aside className="file-panel">
      <FileTabsBar
        tabs={tabs}
        activePath={activePath}
        onSelect={onSelect}
        onClose={onClose}
        onCloseAll={onCloseAll}
        onDetach={onDetach}
        onDock={onDock}
      />
      {active && (
        <div className="file-panel__body">
          <header className="file-panel__bar">
            <span className="file-panel__path">{active.path}</span>
            <span className="file-panel__meta">
              {active.language} · {formatBytes(active.size)}
              {active.truncated && ' · ⚠ 일부만 표시'}
            </span>
            {active.pending && onSetViewMode && (
              <div
                className="file-panel__mode-toggle"
                role="tablist"
                aria-label="보기 모드"
              >
                <button
                  type="button"
                  role="tab"
                  aria-selected={active.viewMode === 'diff'}
                  className={
                    'file-panel__mode-btn' +
                    (active.viewMode === 'diff' ? ' is-active' : '')
                  }
                  onClick={() => onSetViewMode(active.path, 'diff')}
                >
                  Diff
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={active.viewMode === 'normal'}
                  className={
                    'file-panel__mode-btn' +
                    (active.viewMode === 'normal' ? ' is-active' : '')
                  }
                  onClick={() => onSetViewMode(active.path, 'normal')}
                >
                  Original
                </button>
              </div>
            )}
            {isMarkdown && !showingDiff && onSetMarkdownView && (
              <div
                className="file-panel__mode-toggle"
                role="tablist"
                aria-label="마크다운 보기 모드"
              >
                <button
                  type="button"
                  role="tab"
                  aria-selected={active.markdownView === 'rendered'}
                  className={
                    'file-panel__mode-btn' +
                    (active.markdownView === 'rendered' ? ' is-active' : '')
                  }
                  onClick={() => onSetMarkdownView(active.path, 'rendered')}
                >
                  Rendered
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={active.markdownView === 'source'}
                  className={
                    'file-panel__mode-btn' +
                    (active.markdownView === 'source' ? ' is-active' : '')
                  }
                  onClick={() => onSetMarkdownView(active.path, 'source')}
                >
                  Source
                </button>
              </div>
            )}
          </header>
          {active.loading && (
            <div className="file-panel__loading">불러오는 중…</div>
          )}
          {active.error && (
            <div className="file-panel__error">⚠ {active.error}</div>
          )}
          {!active.loading && !active.error && (
            <FileBodyViewer
              tab={active}
              highlighted={highlighted}
              lineCount={lineCount}
              selection={selection}
              codeRef={codeRef}
              onMouseUp={handleMouseUp}
              onClearSelection={clearSelection}
              onAddSelectionToComposer={onAddSelectionToComposer}
            />
          )}
        </div>
      )}
    </aside>
  )
}
