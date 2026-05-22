import type { ToolRequest } from '../../types'
import type { EditPreview } from './preview'

interface Props {
  request: ToolRequest
  preview: EditPreview | null
}

/**
 * 승인 카드 상단의 한 줄 헤더: 아이콘(미리보기가 있으면 ✎, 없으면 ⚙) +
 * 도구 이름 + 미리보기일 때 파일 경로 / 변경 개수 힌트.
 */
export function ApprovalCardHeader({ request, preview }: Props) {
  return (
    <header className="tool-approval-card__header">
      <span className="tool-approval-card__icon" aria-hidden="true">
        {preview ? '✎' : '⚙'}
      </span>
      <span className="tool-approval-card__name">
        {request.title || request.tool_name}
      </span>
      {preview && (
        <span className="tool-approval-card__path" title={preview.filePath}>
          {preview.filePath}
        </span>
      )}
      {preview && preview.parts > 1 && (
        <span className="tool-approval-card__hint">
          {preview.parts}개 변경
        </span>
      )}
    </header>
  )
}
