import type { FileTab } from '../../hooks/useFileTabs'
import type { CodeSnippet } from '../../types/composer'
import { DiffView } from '../DiffView'
import { MarkdownContent } from '../MessageBubble/MarkdownContent'
import { MonacoEditor } from './MonacoEditor'

interface Props {
  tab: FileTab
  /** Virtual (inline) and oversized/truncated files are shown read-only. */
  readOnly: boolean
  onSave: () => void
  onAddSelectionToComposer: (snippet: CodeSnippet) => void
}

/**
 * 활성 탭 본문 — diff / markdown rendered / Monaco 편집기 중 하나를 렌더.
 * 어떤 모드인지는 tab의 viewMode / markdownView / language로 결정된다. 일반
 * 코드 보기는 Monaco 편집기(편집 가능)로, diff와 마크다운 렌더는 기존 뷰로.
 */
export function FileBodyViewer({
  tab,
  readOnly,
  onSave,
  onAddSelectionToComposer,
}: Props) {
  const isMarkdown = tab.language === 'markdown'
  const showingDiff = tab.viewMode === 'diff' && !!tab.pending
  const renderMarkdown =
    isMarkdown && !showingDiff && tab.markdownView !== 'source'

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
    <MonacoEditor
      tab={tab}
      readOnly={readOnly}
      onSave={onSave}
      onAddSelectionToComposer={onAddSelectionToComposer}
    />
  )
}
