import { useMemo } from 'react'
import { marked } from 'marked'
import DOMPurify from 'dompurify'
import { useSelection } from '../../hooks/useSelection'
import { CommentFloat } from '../CommentFloat'
import { MessageList } from '../MessageList'
import type { AssistantSegment, QaPair } from '../../types'
import './MarkdownPane.css'

interface Props {
  pairs: QaPair[]
  selectedId: string | null
  onSelect: (id: string) => void
  isVisible: boolean
}

function renderMarkdown(src: string): string {
  const raw = marked.parse(src, { async: false }) as string
  return DOMPurify.sanitize(raw)
}

function hasVisibleBody(segments: AssistantSegment[]): boolean {
  return segments.some((s) => s.kind === 'text' || s.kind === 'plan')
}

interface SegmentViewProps {
  segment: AssistantSegment
  index: number
}

function SegmentView({ segment, index }: SegmentViewProps) {
  if (segment.kind === 'text') {
    return (
      <div
        className="markdown-pane__content"
        dangerouslySetInnerHTML={{ __html: renderMarkdown(segment.text) }}
      />
    )
  }
  if (segment.kind === 'plan') {
    return (
      <div className="markdown-pane__plan">
        <div className="markdown-pane__plan-label">📋 Plan</div>
        <div
          className="markdown-pane__content"
          dangerouslySetInnerHTML={{ __html: renderMarkdown(segment.text) }}
        />
      </div>
    )
  }
  return (
    <details className="markdown-pane__tool" key={`tool-${index}`}>
      <summary className="markdown-pane__tool-summary">
        <span className="markdown-pane__tool-name">{segment.name}</span>
        {segment.summary && (
          <span className="markdown-pane__tool-arg">{segment.summary}</span>
        )}
      </summary>
    </details>
  )
}

export function MarkdownPane({ pairs, selectedId, onSelect, isVisible }: Props) {
  const { selection, handleMouseUp, clearSelection } = useSelection()

  const selected = useMemo(
    () => pairs.find((p) => p.id === selectedId) ?? null,
    [pairs, selectedId]
  )

  return (
    <div
      className="markdown-pane"
      style={{ display: isVisible ? 'flex' : 'none' }}
    >
      <div className="markdown-pane__sidebar">
        <MessageList pairs={pairs} selectedId={selectedId} onSelect={onSelect} />
      </div>
      <div className="markdown-pane__body" onMouseUp={handleMouseUp}>
        {selected ? (
          <>
            <div className="markdown-pane__question">
              <div className="markdown-pane__question-label">질문</div>
              <div className="markdown-pane__question-text">{selected.user_text}</div>
            </div>
            {selected.segments.length > 0 ? (
              <div className="markdown-pane__segments">
                {selected.segments.map((seg, i) => (
                  <SegmentView key={i} segment={seg} index={i} />
                ))}
                {!hasVisibleBody(selected.segments) && (
                  <div className="markdown-pane__pending">텍스트 응답 대기 중…</div>
                )}
              </div>
            ) : (
              <div className="markdown-pane__pending">응답 대기 중…</div>
            )}
          </>
        ) : (
          <div className="markdown-pane__placeholder">좌측에서 항목을 선택하세요</div>
        )}
        {selection.text && selection.rect && (
          <CommentFloat
            selection={{ text: selection.text, rect: selection.rect }}
            onClose={clearSelection}
          />
        )}
      </div>
    </div>
  )
}
