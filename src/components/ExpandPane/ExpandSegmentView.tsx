import type { AssistantSegment } from '../../types'
import { SegmentView } from '../MessageBubble'
import { FilePath, type OpenFileFn } from '../ToolViews'

const FILE_PATH_TOOLS = new Set([
  'Read',
  'Edit',
  'Write',
  'MultiEdit',
  'NotebookEdit',
])

function thinkingLabel(seg: Extract<AssistantSegment, { kind: 'thinking' }>): string {
  // QaCard와 동일 — partial 동안엔 트레일링 "…"를 빼고, 끝나면 측정된
  // duration을 "Thought for Ns"로 표기.
  if (seg.partial) return 'Thinking'
  if (typeof seg.duration_ms === 'number') {
    return `Thought for ${Math.max(1, Math.round(seg.duration_ms / 1000))}s`
  }
  return 'Thinking'
}

interface Props {
  segment: AssistantSegment
  onOpenFile?: OpenFileFn
}

/**
 * ExpandPane이 전용으로 쓰는 segment 라우터:
 *   thinking → "● Thought for Ns" 한 줄
 *   tool_use → "● <Name> arg" 한 줄 (file_path 도구는 클릭 가능한 링크)
 *   tool_result → 숨김 (전체 내용은 MessageBubble 쪽에서 처리)
 *   그 외 (text/plan/image/redacted_thinking 등) → 공통 SegmentView로 위임
 */
export function ExpandSegmentView({ segment, onOpenFile }: Props) {
  if (segment.kind === 'tool_result') return null
  if (segment.kind === 'thinking') {
    return (
      <div className="expand-pane__step">
        <span className="expand-pane__step-dot" aria-hidden="true" />
        <span className="expand-pane__step-label">{thinkingLabel(segment)}</span>
      </div>
    )
  }
  if (segment.kind === 'tool_use') {
    const isFilePath = FILE_PATH_TOOLS.has(segment.name) && segment.summary
    return (
      <div className="expand-pane__step">
        <span className="expand-pane__step-dot" aria-hidden="true" />
        <span className="expand-pane__step-tool">{segment.name}</span>
        {isFilePath ? (
          <FilePath
            path={segment.summary}
            onOpen={onOpenFile}
            className="expand-pane__step-arg expand-pane__step-arg--link"
          />
        ) : (
          segment.summary && (
            <span className="expand-pane__step-arg">{segment.summary}</span>
          )
        )}
      </div>
    )
  }
  return <SegmentView segment={segment} onOpenFile={onOpenFile} />
}
