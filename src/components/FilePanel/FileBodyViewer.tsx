import type { FileTab } from '../../hooks/useFileTabs'
import type { CodeSnippet } from '../../types/composer'
import { DiffView } from '../DiffView'
import { MarkdownContent } from '../MessageBubble/MarkdownContent'
import { highlight, langForPrism } from './highlight'
import type { CodeSelection } from './useCodeSelection'

interface Props {
  tab: FileTab
  /** highlight(content, lang) 결과. 부모에서 memoize한다. */
  highlighted: string
  /** content를 줄 수로 자른 값. 부모에서 memoize한다. */
  lineCount: number
  /** 현재 선택 — 있으면 코멘트 추가 affordance가 뜬다. */
  selection: CodeSelection | null
  codeRef: React.MutableRefObject<HTMLDivElement | null>
  onMouseUp: () => void
  onClearSelection: () => void
  onAddSelectionToComposer: (snippet: CodeSnippet) => void
}

/**
 * 활성 탭 본문 — diff / markdown rendered / source code 중 하나를 렌더.
 * 어떤 모드인지는 tab의 viewMode / markdownView / language로 결정된다.
 */
export function FileBodyViewer({
  tab,
  highlighted,
  lineCount,
  selection,
  codeRef,
  onMouseUp,
  onClearSelection,
  onAddSelectionToComposer,
}: Props) {
  const isMarkdown = tab.language === 'markdown'
  const showingDiff = tab.viewMode === 'diff' && !!tab.pending
  const renderMarkdown = isMarkdown && !showingDiff && tab.markdownView !== 'source'

  if (showingDiff && tab.pending) {
    return (
      <div className="file-panel__diff">
        <DiffView
          oldText={tab.pending.oldText}
          newText={tab.pending.newText}
          sideBySide
          collapsibleLabel={null}
        />
      </div>
    )
  }
  if (renderMarkdown) {
    return (
      <div className="file-panel__markdown">
        <MarkdownContent
          className="file-panel__markdown-content message-bubble__content"
          source={tab.content}
        />
      </div>
    )
  }
  return (
    <div ref={codeRef} className="file-panel__code" onMouseUp={onMouseUp}>
      <div className="file-panel__gutter" aria-hidden="true">
        {Array.from({ length: lineCount }, (_, i) => (
          <span key={i}>{i + 1}</span>
        ))}
      </div>
      <pre className={`language-${langForPrism(tab.language)}`}>
        <code
          className={`language-${langForPrism(tab.language)}`}
          dangerouslySetInnerHTML={{ __html: highlighted }}
        />
      </pre>
      {selection && (
        <div
          className="file-panel__comment"
          style={{ top: selection.rect.top, left: selection.rect.left }}
          // mouseup이 다시 버블링하면 선택이 즉시 풀려서 affordance가 사라진다.
          onMouseDown={(e) => e.preventDefault()}
        >
          <button
            type="button"
            onClick={() => {
              onAddSelectionToComposer({
                text: selection.text,
                path: tab.path,
                startLine: selection.startLine,
                endLine: selection.endLine,
              })
              window.getSelection()?.removeAllRanges()
              onClearSelection()
            }}
          >
            💬 코멘트로 추가
          </button>
        </div>
      )}
    </div>
  )
}

// 외부에서 차후에 도움이 될지도 모를 helper 그대로 사용 (실제로 부모가 빌드).
export { highlight, langForPrism }
