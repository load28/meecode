import { useEffect, useMemo, useRef, useState } from 'react'
import type {
  FileTab,
  FileViewMode,
  MarkdownView,
} from '../../hooks/useFileTabs'
import { DiffView } from '../DiffView'
import { MarkdownContent } from '../MessageBubble/MarkdownContent'
import { highlight, langForPrism } from './highlight'
import { basename, formatBytes, offsetWithin } from './utils'
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

interface SelectionState {
  text: string
  startLine: number
  endLine: number
  rect: { top: number; left: number }
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
  const codeRef = useRef<HTMLDivElement | null>(null)
  const [selection, setSelection] = useState<SelectionState | null>(null)

  const active = useMemo(
    () => tabs.find((t) => t.path === activePath) ?? null,
    [tabs, activePath],
  )

  const highlighted = useMemo(() => {
    if (!active) return ''
    return highlight(active.content, active.language)
  }, [active])

  const isMarkdown = active?.language === 'markdown'
  const showingDiff = active?.viewMode === 'diff' && !!active.pending
  const renderMarkdown =
    isMarkdown && !showingDiff && active?.markdownView !== 'source'

  const lineCount = useMemo(() => {
    if (!active) return 0
    return active.content.split('\n').length
  }, [active])

  useEffect(() => {
    // Selection lives only for the current tab.
    setSelection(null)
  }, [activePath])

  const handleMouseUp = () => {
    const sel = window.getSelection()
    if (!sel || sel.isCollapsed) {
      setSelection(null)
      return
    }
    const text = sel.toString()
    if (!text.trim()) {
      setSelection(null)
      return
    }
    const range = sel.getRangeAt(0)
    const code = codeRef.current
    if (!code) return
    // Selection must be inside this code block.
    if (!code.contains(range.commonAncestorContainer)) {
      setSelection(null)
      return
    }
    const before = code.textContent?.slice(
      0,
      code.textContent
        ? offsetWithin(code, range.startContainer, range.startOffset)
        : 0,
    ) ?? ''
    const startLine = before.split('\n').length
    const endLine = startLine + text.split('\n').length - 1
    const rect = range.getBoundingClientRect()
    const codeRect = code.getBoundingClientRect()
    setSelection({
      text,
      startLine,
      endLine,
      rect: {
        top: rect.top - codeRect.top + code.scrollTop + rect.height + 6,
        left: rect.left - codeRect.left + code.scrollLeft,
      },
    })
  }

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
      <div className="file-panel__tabs" role="tablist">
        {tabs.map((t) => (
          <div
            key={t.path}
            role="tab"
            aria-selected={t.path === activePath}
            className={
              'file-panel__tab' +
              (t.path === activePath ? ' is-active' : '')
            }
          >
            <button
              type="button"
              className="file-panel__tab-button"
              onClick={() => onSelect(t.path)}
              title={t.path}
            >
              <span className="file-panel__tab-name">{basename(t.path)}</span>
              {t.pending && (
                <span
                  className="file-panel__tab-marker"
                  aria-label="변경 사항 있음"
                  title="변경 사항 있음"
                >
                  ●
                </span>
              )}
            </button>
            <button
              type="button"
              className="file-panel__tab-close"
              onClick={() => onClose(t.path)}
              aria-label="탭 닫기"
            >
              ×
            </button>
          </div>
        ))}
        {tabs.length > 1 && (
          <button
            type="button"
            className="file-panel__close-all"
            onClick={onCloseAll}
            title="모두 닫기"
          >
            ×× 모두 닫기
          </button>
        )}
        {onDetach && (
          <button
            type="button"
            className="file-panel__action"
            onClick={onDetach}
            title="별도 창으로 분리"
          >
            ⧉ 분리
          </button>
        )}
        {onDock && (
          <button
            type="button"
            className="file-panel__action"
            onClick={onDock}
            title="메인 창으로 도킹"
          >
            ⊟ 도킹
          </button>
        )}
      </div>
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
            <>
              {active.viewMode === 'diff' && active.pending ? (
                <div className="file-panel__diff">
                  <DiffView
                    oldText={active.pending.oldText}
                    newText={active.pending.newText}
                    sideBySide
                    collapsibleLabel={null}
                  />
                </div>
              ) : renderMarkdown ? (
                <div className="file-panel__markdown">
                  <MarkdownContent
                    className="file-panel__markdown-content message-bubble__content"
                    source={active.content}
                  />
                </div>
              ) : (
                <div
                  ref={codeRef}
                  className="file-panel__code"
                  onMouseUp={handleMouseUp}
                >
                  <div className="file-panel__gutter" aria-hidden="true">
                    {Array.from({ length: lineCount }, (_, i) => (
                      <span key={i}>{i + 1}</span>
                    ))}
                  </div>
                  <pre className={`language-${langForPrism(active.language)}`}>
                    <code
                      className={`language-${langForPrism(active.language)}`}
                      dangerouslySetInnerHTML={{ __html: highlighted }}
                    />
                  </pre>
                  {selection && (
                    <div
                      className="file-panel__comment"
                      style={{ top: selection.rect.top, left: selection.rect.left }}
                      // Don't bubble mouseup or it clears the selection itself.
                      onMouseDown={(e) => e.preventDefault()}
                    >
                      <button
                        type="button"
                        onClick={() => {
                          onAddSelectionToComposer({
                            text: selection.text,
                            path: active.path,
                            startLine: selection.startLine,
                            endLine: selection.endLine,
                          })
                          window.getSelection()?.removeAllRanges()
                          setSelection(null)
                        }}
                      >
                        💬 코멘트로 추가
                      </button>
                    </div>
                  )}
                </div>
              )}
            </>
          )}
        </div>
      )}
    </aside>
  )
}
