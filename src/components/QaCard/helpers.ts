import type { AssistantSegment, QaPair } from '../../types'
import type { PendingEdit } from '../../hooks/useFileTabs'
import { pickArray, pickString } from '../../utils/inputAccess'
import { FILE_PATH_TOOLS, thinkingLabel } from '../../utils/assistantSegment'

// utils로 이전됐지만 외부에서 `./helpers`로 import하던 사이트(QaSegmentView,
// StepRow) 호환을 위해 re-export.
export { FILE_PATH_TOOLS, thinkingLabel }

/**
 * Q&A 본문 영역을 접는 임계 높이(px). 6~7줄 정도면 카드가 여전히
 * 콤팩트하게 보이면서, 그 이상은 더 보기로 펼치도록 한다.
 */
export const ANSWER_MAX_HEIGHT_PX = 180

/**
 * Edit/Write/MultiEdit/NotebookEdit tool_use에서 PendingEdit을 복원해
 * 파일 경로 클릭 시 diff 패널이 함께 열리게 한다. 다른 도구는 null.
 */
export function pendingFromSegment(
  seg: Extract<AssistantSegment, { kind: 'tool_use' }>,
): PendingEdit | null {
  switch (seg.name) {
    case 'Edit':
      return {
        kind: 'edit',
        oldText: pickString(seg.input, 'old_string'),
        newText: pickString(seg.input, 'new_string'),
      }
    case 'Write':
      return {
        kind: 'write',
        oldText: '',
        newText: pickString(seg.input, 'content'),
      }
    case 'MultiEdit': {
      const edits = pickArray(seg.input, 'edits') as Array<{
        old_string?: string
        new_string?: string
      }>
      return {
        kind: 'multiedit',
        oldText: edits
          .map((e) => (typeof e.old_string === 'string' ? e.old_string : ''))
          .join('\n'),
        newText: edits
          .map((e) => (typeof e.new_string === 'string' ? e.new_string : ''))
          .join('\n'),
        label: `${edits.length}개 변경`,
      }
    }
    case 'NotebookEdit':
      return {
        kind: 'notebookedit',
        oldText: '',
        newText: pickString(seg.input, 'new_source'),
      }
    default:
      return null
  }
}


/**
 * 한 Q&A 턴을 플레인 텍스트 블록으로 직렬화. Source로 저장될 때나
 * Task의 Wiki를 LLM이 다시 읽을 때 tool 단계를 식별할 수 있도록
 * `[tool …]` 태그를 인라인으로 붙인다.
 */
export function buildPairText(pair: QaPair): string {
  const assistant = pair.segments
    .map((s) => {
      switch (s.kind) {
        case 'text':
        case 'plan':
        case 'thinking':
          return s.text
        case 'tool_use':
          return `[tool ${s.name}] ${s.summary}`
        case 'tool_result':
          return s.is_error
            ? `[tool error]\n${s.text}`
            : `[tool result]\n${s.text}`
        default:
          return ''
      }
    })
    .filter(Boolean)
    .join('\n\n')
  return `## Q\n${pair.user_text}\n\n## A\n${assistant}`
}
