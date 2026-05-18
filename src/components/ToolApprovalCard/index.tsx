import type { ToolRequest } from '../../types'
import { AskUserQuestionCard, type AskInput } from '../AskUserQuestionCard'
import './ToolApprovalCard.css'

interface Props {
  request: ToolRequest
  onRespond: (allow: boolean, updatedInput?: unknown) => void
}

function summarize(input: unknown): string {
  if (!input || typeof input !== 'object') return ''
  const obj = input as Record<string, unknown>
  const candidates = [
    'command',
    'file_path',
    'pattern',
    'query',
    'url',
    'description',
    'skill',
  ]
  for (const key of candidates) {
    const v = obj[key]
    if (typeof v === 'string' && v) return v
  }
  return JSON.stringify(obj).slice(0, 200)
}

export function ToolApprovalCard({ request, onRespond }: Props) {
  if (request.tool_name === 'AskUserQuestion') {
    const input = (request.input ?? { questions: [] }) as AskInput
    return (
      <AskUserQuestionCard
        input={input}
        onRespond={(allow, updated) => onRespond(allow, updated ?? undefined)}
      />
    )
  }

  return (
    <section
      className="tool-approval-card"
      role="region"
      aria-label="도구 승인 요청"
    >
      <header className="tool-approval-card__header">
        <span className="tool-approval-card__icon" aria-hidden="true">
          ⚙️
        </span>
        <span className="tool-approval-card__name">
          {request.title || request.tool_name}
        </span>
      </header>
      <pre className="tool-approval-card__summary">
        {summarize(request.input)}
      </pre>
      {request.decision_reason && (
        <div className="tool-approval-card__reason">
          🛈 {request.decision_reason}
        </div>
      )}
      {request.blocked_path && (
        <div className="tool-approval-card__blocked">
          ⛔ {request.blocked_path}
        </div>
      )}
      <div className="tool-approval-card__buttons">
        <button
          type="button"
          className="tool-approval-card__deny"
          onClick={() => onRespond(false)}
        >
          거부
        </button>
        <button
          type="button"
          className="tool-approval-card__allow"
          onClick={() => onRespond(true)}
        >
          허용
        </button>
      </div>
    </section>
  )
}
