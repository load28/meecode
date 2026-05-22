import type { AssistantSegment } from '../../types'
import type { PendingEdit } from '../../hooks/useFileTabs'
import { FilePath, type OpenFileFn } from '../ToolViews'
import { FILE_PATH_TOOLS, pendingFromSegment, thinkingLabel } from './helpers'

type ThinkingSeg = Extract<AssistantSegment, { kind: 'thinking' }>
type ToolUseSeg = Extract<AssistantSegment, { kind: 'tool_use' }>

/** thinking 한 줄("● Thought for Ns") 표시. */
export function ThinkingStep({ segment }: { segment: ThinkingSeg }) {
  return (
    <div className="qa-card__step">
      <span className="qa-card__step-dot" aria-hidden="true" />
      <span className="qa-card__step-label">{thinkingLabel(segment)}</span>
    </div>
  )
}

/**
 * tool_use 한 줄("● <ToolName> <arg-preview>") 표시. Edit/Write 계열일
 * 때는 summary가 파일 경로이므로 클릭 가능한 FilePath로 렌더하고, 그
 * 파일 패널이 자동으로 diff 뷰를 열 수 있게 PendingEdit을 함께 넘긴다.
 */
export function ToolUseStep({
  segment,
  onOpenFile,
}: {
  segment: ToolUseSeg
  onOpenFile?: OpenFileFn
}) {
  const isFilePath = FILE_PATH_TOOLS.has(segment.name) && !!segment.summary
  const pending: PendingEdit | null = isFilePath
    ? pendingFromSegment(segment)
    : null
  const handleOpen = onOpenFile
    ? (p: string) => onOpenFile(p, pending ? { pending } : undefined)
    : undefined
  return (
    <div className="qa-card__step">
      <span className="qa-card__step-dot" aria-hidden="true" />
      <span className="qa-card__step-tool">{segment.name}</span>
      {isFilePath ? (
        <FilePath
          path={segment.summary}
          onOpen={handleOpen}
          className="qa-card__step-arg qa-card__step-arg--link"
        />
      ) : (
        segment.summary && (
          <span className="qa-card__step-arg">{segment.summary}</span>
        )
      )}
    </div>
  )
}
