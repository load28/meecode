import type { AssistantSegment } from '../../types'
import { renderMarkdown, SegmentView } from '../MessageBubble'
import { type OpenFileFn } from '../ToolViews'
import { makePreview } from '../../utils/segmentHelpers'
import { INTERRUPTED_BY_USER } from '../../utils/messages'
import { ThinkingStep, ToolUseStep } from './StepRow'

interface Props {
  segment: AssistantSegment
  onOpenFile?: OpenFileFn
}

/**
 * QaCard 본문에서 한 segment를 어떻게 보여줄지 라우팅.
 *
 *   tool_result → 숨김(요약 카드에서는 노이즈; 전체보기 패널에서 노출)
 *   interrupted → 한 줄 inline 알림
 *   thinking    → "● Thought for Ns" 한 줄
 *   tool_use    → "● <Name> arg" 한 줄 (file_path 도구는 링크)
 *   text/plan   → makePreview로 잘린 마크다운 한 블록
 *   기타       → 공통 SegmentView로 위임 (image / redacted_thinking)
 */
export function QaSegmentView({ segment, onOpenFile }: Props) {
  if (segment.kind === 'tool_result') return null
  if (segment.kind === 'interrupted') {
    return (
      <div className="qa-card__interrupted" role="note">
        <span aria-hidden="true">⛔</span>
        <span>{INTERRUPTED_BY_USER}</span>
      </div>
    )
  }
  if (segment.kind === 'thinking') {
    return <ThinkingStep segment={segment} />
  }
  if (segment.kind === 'tool_use') {
    return <ToolUseStep segment={segment} onOpenFile={onOpenFile} />
  }
  if (segment.kind === 'text' || segment.kind === 'plan') {
    return (
      <div
        // `message-bubble__content`는 공유 리스트/blockquote/spacing 규칙을
        // 적용 — 없으면 글로벌 `* { padding: 0 }`가 리스트 인덴트를 깎는다.
        className="qa-card__preview message-bubble__content"
        dangerouslySetInnerHTML={{
          __html: renderMarkdown(makePreview(segment.text)),
        }}
      />
    )
  }
  // image, redacted_thinking — 그대로 공통 뷰로.
  return <SegmentView segment={segment} onOpenFile={onOpenFile} />
}
