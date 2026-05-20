import { useEffect, useMemo, useRef, useState } from 'react'
import Prism from 'prismjs'
import type { FileTab, FileViewMode } from '../../hooks/useFileTabs'
import { DiffView } from '../DiffView'
import './FilePanel.css'

interface Props {
  tabs: FileTab[]
  activePath: string | null
  onSelect: (path: string) => void
  onClose: (path: string) => void
  onCloseAll: () => void
  onSetViewMode?: (path: string, mode: FileViewMode) => void
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

function langForPrism(lang: string): string {
  // Map our backend's language label to Prism's component names. Unknown
  // values fall back to plaintext so highlight() doesn't throw.
  if (Prism.languages[lang]) return lang
  return 'plaintext'
}

function highlight(content: string, lang: string): string {
  const key = langForPrism(lang)
  const grammar = Prism.languages[key]
  if (!grammar) return escapeHtml(content)
  try {
    return Prism.highlight(content, grammar, key)
  } catch {
    return escapeHtml(content)
  }
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

export function FilePanel({
  tabs,
  activePath,
  onSelect,
  onClose,
  onCloseAll,
  onSetViewMode,
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

function basename(p: string): string {
  const parts = p.split('/')
  return parts[parts.length - 1] || p
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / 1024 / 1024).toFixed(2)} MB`
}

// Compute the absolute character offset of `(node, offset)` inside `root`.
function offsetWithin(root: Node, node: Node, offset: number): number {
  let total = 0
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null)
  let cur: Node | null
  while ((cur = walker.nextNode())) {
    if (cur === node) return total + offset
    total += (cur.textContent ?? '').length
  }
  return total
}
