import { marked } from 'marked'
import DOMPurify from 'dompurify'
import type { AssistantSegment } from '../../types'
import { ToolUseView } from '../ToolViews'
import './MessageBubble.css'

export function renderMarkdown(src: string): string {
  const raw = marked.parse(src, { async: false }) as string
  return DOMPurify.sanitize(raw)
}

interface SegmentViewProps {
  segment: AssistantSegment
}

export function SegmentView({ segment }: SegmentViewProps) {
  if (segment.kind === 'text') {
    return (
      <div
        className="message-bubble__content"
        dangerouslySetInnerHTML={{ __html: renderMarkdown(segment.text) }}
      />
    )
  }
  if (segment.kind === 'plan') {
    return (
      <div className="message-bubble__plan">
        <div className="message-bubble__plan-label">📋 Plan</div>
        <div
          className="message-bubble__content"
          dangerouslySetInnerHTML={{ __html: renderMarkdown(segment.text) }}
        />
      </div>
    )
  }
  if (segment.kind === 'thinking') {
    return (
      <details className="message-bubble__thinking">
        <summary className="message-bubble__thinking-summary">
          <span className="message-bubble__thinking-icon" aria-hidden="true">💭</span>
          <span>Thinking</span>
        </summary>
        <div
          className="message-bubble__thinking-text"
          dangerouslySetInnerHTML={{ __html: renderMarkdown(segment.text) }}
        />
      </details>
    )
  }
  if (segment.kind === 'tool_result') {
    const cls = segment.is_error
      ? 'message-bubble__tool-result is-error'
      : 'message-bubble__tool-result'
    const label = segment.is_error ? '❌ 도구 실패' : '✓ 도구 결과'
    return (
      <details className={cls}>
        <summary className="message-bubble__tool-result-summary">
          <span className="message-bubble__tool-result-label">{label}</span>
          {segment.text && (
            <span className="message-bubble__tool-result-preview">
              {segment.text.split('\n')[0].slice(0, 100)}
            </span>
          )}
        </summary>
        {segment.text && (
          <pre className="message-bubble__tool-result-body">{segment.text}</pre>
        )}
      </details>
    )
  }
  return <ToolUseView segment={segment} />
}
