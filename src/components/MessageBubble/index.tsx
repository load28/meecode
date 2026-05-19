import type { AssistantSegment } from '../../types'
import { useSmoothedText } from '../../hooks/useSmoothedText'
import { ToolUseView } from '../ToolViews'
import { MarkdownContent, renderMarkdown } from './MarkdownContent'
import './MessageBubble.css'

export { renderMarkdown }

interface SegmentViewProps {
  segment: AssistantSegment
  onOpenFile?: (path: string) => void
  defaultOpen?: boolean
}

export function SegmentView({ segment, onOpenFile, defaultOpen }: SegmentViewProps) {
  if (segment.kind === 'text') {
    return <TextSegment segment={segment} />
  }
  if (segment.kind === 'plan') {
    return (
      <div className="message-bubble__plan">
        <div className="message-bubble__plan-label">📋 Plan</div>
        <MarkdownContent
          className="message-bubble__content"
          source={segment.text}
        />
      </div>
    )
  }
  if (segment.kind === 'thinking') {
    const label = segment.partial
      ? 'Thinking…'
      : typeof segment.duration_ms === 'number'
      ? `Thought for ${Math.max(1, Math.round(segment.duration_ms / 1000))}s`
      : 'Thinking'
    const hasBody = segment.text.length > 0
    const containerCls = segment.partial
      ? 'message-bubble__thinking message-bubble__thinking--live'
      : 'message-bubble__thinking'
    const header = (
      <div className="message-bubble__thinking-summary">
        <span className="message-bubble__thinking-icon" aria-hidden="true">
          💭
        </span>
        <span>{label}</span>
        {segment.partial && (
          <span className="message-bubble__thinking-dots" aria-hidden="true">
            <span />
            <span />
            <span />
          </span>
        )}
      </div>
    )
    // No <details> toggle — thinking is shown inline as one step of the
    // response process. When the API returned only a signature (no thinking
    // body), collapse to a single-line badge so the UI doesn't leave an
    // empty container behind.
    if (!hasBody) {
      return <div className={`${containerCls} message-bubble__thinking--badge`}>{header}</div>
    }
    return (
      <div className={containerCls}>
        {header}
        <MarkdownContent
          className="message-bubble__thinking-text"
          source={segment.text}
        />
      </div>
    )
  }
  if (segment.kind === 'skill_body') {
    return (
      <details className="message-bubble__skill-body">
        <summary className="message-bubble__skill-body-summary">
          <span aria-hidden="true">📚</span>
          <span>Skill 본문</span>
          <span className="message-bubble__skill-body-name">{segment.skill}</span>
        </summary>
        <MarkdownContent
          className="message-bubble__skill-body-text"
          source={segment.text}
        />
      </details>
    )
  }
  if (segment.kind === 'redacted_thinking') {
    return (
      <div className="message-bubble__redacted" aria-label="가려진 추론">
        🔒 가려진 추론 (안전상 본문이 노출되지 않음)
      </div>
    )
  }
  if (segment.kind === 'image') {
    if (segment.data_url) {
      return (
        <div className="message-bubble__image">
          <img src={segment.data_url} alt={segment.media_type} />
        </div>
      )
    }
    return (
      <div className="message-bubble__image-placeholder" aria-label="이미지">
        🖼 이미지 ({segment.media_type})
      </div>
    )
  }
  if (segment.kind === 'tool_result') {
    const cls = segment.is_error
      ? 'message-bubble__tool-result is-error'
      : 'message-bubble__tool-result'
    const label = segment.is_error ? '❌ 도구 실패' : '✓ 도구 결과'
    return (
      <details className={cls} open={defaultOpen}>
        <summary className="message-bubble__tool-result-summary">
          <span className="message-bubble__tool-result-label">{label}</span>
          {segment.text && (
            <span className="message-bubble__tool-result-preview">
              {/* Hand the first ~400 chars to CSS line-clamp instead of
                  forcing a single-line cutoff; the clamp shows the first
                  3 lines so long results stay informative when collapsed. */}
              {segment.text.slice(0, 400)}
            </span>
          )}
        </summary>
        {segment.text && (
          <pre className="message-bubble__tool-result-body">{segment.text}</pre>
        )}
      </details>
    )
  }
  return (
    <ToolUseView
      segment={segment}
      onOpenFile={onOpenFile}
      defaultOpen={defaultOpen}
    />
  )
}

// Extracted so `useSmoothedText` only mounts on text segments — kept outside
// SegmentView's per-kind switch to keep the hook order stable when the
// segment list re-renders. Renders markdown live while streaming, snapping
// to the full text once `partial` flips false.
function TextSegment({
  segment,
}: {
  segment: Extract<AssistantSegment, { kind: 'text' }>
}) {
  const displayed = useSmoothedText(segment.text, segment.partial === true)
  return (
    <MarkdownContent className="message-bubble__content" source={displayed} />
  )
}
