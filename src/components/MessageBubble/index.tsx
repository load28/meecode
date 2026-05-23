import type { AssistantSegment } from '../../types'
import { ToolUseView, type OpenFileFn } from '../ToolViews'
import { renderMarkdown } from './MarkdownContent'
import {
  ImageSegment,
  InterruptedSegment,
  PlanSegment,
  RedactedThinkingSegment,
  SkillBodySegment,
  TextSegment,
  ThinkingSegment,
  ToolResultSegment,
} from './segments'
import './MessageBubble.css'

export { renderMarkdown }

interface SegmentViewProps {
  segment: AssistantSegment
  onOpenFile?: OpenFileFn
  defaultOpen?: boolean
}

/**
 * 어시스턴트의 한 segment를 그 kind에 맞는 leaf 컴포넌트로 라우팅.
 * tool_use는 ToolViews의 ToolUseView 디스패처로 위임된다.
 */
export function SegmentView({
  segment,
  onOpenFile,
  defaultOpen,
}: SegmentViewProps) {
  switch (segment.kind) {
    case 'text':
      return <TextSegment segment={segment} />
    case 'plan':
      return <PlanSegment segment={segment} />
    case 'thinking':
      return <ThinkingSegment segment={segment} />
    case 'skill_body':
      return <SkillBodySegment segment={segment} />
    case 'interrupted':
      return <InterruptedSegment />
    case 'redacted_thinking':
      return <RedactedThinkingSegment />
    case 'image':
      return <ImageSegment segment={segment} />
    case 'tool_result':
      return <ToolResultSegment segment={segment} defaultOpen={defaultOpen} />
    case 'tool_use':
      return (
        <ToolUseView
          segment={segment}
          onOpenFile={onOpenFile}
          defaultOpen={defaultOpen}
        />
      )
  }
}
