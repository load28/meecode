import { marked } from 'marked'
import DOMPurify from 'dompurify'
import type { AssistantSegment } from '../../types'
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
  return (
    <details className="message-bubble__tool">
      <summary className="message-bubble__tool-summary">
        <span className="message-bubble__tool-name">{segment.name}</span>
        {segment.summary && (
          <span className="message-bubble__tool-arg">{segment.summary}</span>
        )}
      </summary>
    </details>
  )
}
