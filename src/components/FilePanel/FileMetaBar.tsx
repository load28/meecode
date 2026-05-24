import type {
  FileTab,
  FileViewMode,
  MarkdownView,
} from '../../hooks/useFileTabs'
import { formatBytes } from './utils'

interface Props {
  tab: FileTab
  isMarkdown: boolean
  showingDiff: boolean
  onSetViewMode?: (path: string, mode: FileViewMode) => void
  onSetMarkdownView?: (path: string, view: MarkdownView) => void
}

/**
 * 본문 위쪽의 메타 바: 파일 경로, language/size, 그리고 적절한 토글
 * 두 종류. pending 변경이 있을 때는 Diff/Original 토글, 마크다운일
 * 때는 Rendered/Source 토글이 노출된다(diff 모드일 때는 마크다운 토글
 * 숨김).
 */
export function FileMetaBar({
  tab,
  isMarkdown,
  showingDiff,
  onSetViewMode,
  onSetMarkdownView,
}: Props) {
  return (
    <header className="file-panel__bar">
      <span className="file-panel__path">{tab.title ?? tab.path}</span>
      <span className="file-panel__meta">
        {tab.language} · {formatBytes(tab.size)}
        {tab.truncated && ' · ⚠ 일부만 표시'}
      </span>
      {tab.pending && onSetViewMode && (
        <div
          className="file-panel__mode-toggle"
          role="tablist"
          aria-label="보기 모드"
        >
          <ModeButton
            label="Diff"
            active={tab.viewMode === 'diff'}
            onClick={() => onSetViewMode(tab.path, 'diff')}
          />
          <ModeButton
            label="Original"
            active={tab.viewMode === 'normal'}
            onClick={() => onSetViewMode(tab.path, 'normal')}
          />
        </div>
      )}
      {isMarkdown && !showingDiff && onSetMarkdownView && (
        <div
          className="file-panel__mode-toggle"
          role="tablist"
          aria-label="마크다운 보기 모드"
        >
          <ModeButton
            label="Rendered"
            active={tab.markdownView === 'rendered'}
            onClick={() => onSetMarkdownView(tab.path, 'rendered')}
          />
          <ModeButton
            label="Source"
            active={tab.markdownView === 'source'}
            onClick={() => onSetMarkdownView(tab.path, 'source')}
          />
        </div>
      )}
    </header>
  )
}

function ModeButton({
  label,
  active,
  onClick,
}: {
  label: string
  active: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      className={'file-panel__mode-btn' + (active ? ' is-active' : '')}
      onClick={onClick}
    >
      {label}
    </button>
  )
}
