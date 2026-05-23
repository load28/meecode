import { useMemo, useRef, useState } from 'react'
import type { ToolRequest } from '../../types'
import { AskUserQuestionCard, type AskInput } from '../AskUserQuestionCard'
import { DiffView } from '../DiffView'
import { extractPreview, summarize } from './preview'
import { buildOptions, type ApprovalKey } from './options'
import { ApprovalOptions } from './ApprovalOptions'
import { DenyMessageForm } from './DenyMessageForm'
import { useApprovalKeyboard } from './useApprovalKeyboard'
import { ApprovalCardHeader } from './ApprovalCardHeader'
import './ToolApprovalCard.css'

interface Props {
  request: ToolRequest
  onRespond: (
    allow: boolean,
    updatedInput?: unknown,
    denialMessage?: string | null,
  ) => void
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

  const preview = useMemo(() => extractPreview(request), [request])
  const options = useMemo(() => buildOptions(request), [request])
  const containerRef = useRef<HTMLElement | null>(null)
  // "거부 + 의견 전달"을 고르면 즉시 onRespond를 호출하지 않고 인라인
  // 폼을 펼친다. 실제 전송은 폼이 자체적으로 사용자의 명시적 액션을
  // 받아 진행 — 실수로 Enter를 눌러 미완성 메시지가 나가는 일을 막는다.
  const [denyMode, setDenyMode] = useState(false)

  const handleSelect = (key: ApprovalKey) => {
    if (key === 'deny') {
      onRespond(false)
      return
    }
    if (key === 'deny-with-message') {
      setDenyMode(true)
      return
    }
    if (key === 'allow-always') {
      // The backend disambiguates via the suggestion field — for now we use
      // the same allow channel since meecode's respond_tool only knows
      // allow/deny. The "always" intent is communicated by passing the
      // raw suggestion back as updated_input so the backend (or a future
      // permission-rule store) can persist it.
      const suggestion = request.permission_suggestions?.find(
        (s) => s.type === 'addRules' || s.type === 'allow' || s.type === 'session',
      )
      onRespond(true, { ...(request.input as object | null), __apply_suggestion: suggestion })
      return
    }
    onRespond(true)
  }

  useApprovalKeyboard({ containerRef, options, onSelect: handleSelect })

  return (
    <section
      ref={containerRef}
      className={
        'tool-approval-card' +
        (preview ? ' tool-approval-card--with-diff' : '')
      }
      role="region"
      aria-label="도구 승인 요청"
      tabIndex={-1}
    >
      <ApprovalCardHeader request={request} preview={preview} />

      {preview ? (
        <div className="tool-approval-card__diff-wrap">
          <DiffView
            oldText={preview.oldText}
            newText={preview.newText}
            sideBySide
            collapsibleLabel={null}
          />
        </div>
      ) : (
        <pre className="tool-approval-card__summary">{summarize(request.input)}</pre>
      )}

      {request.decision_reason && (
        <div className="tool-approval-card__reason">🛈 {request.decision_reason}</div>
      )}
      {request.blocked_path && (
        <div className="tool-approval-card__blocked">⛔ {request.blocked_path}</div>
      )}

      {denyMode ? (
        <DenyMessageForm
          onSubmit={(message) => onRespond(false, undefined, message)}
          onCancel={() => setDenyMode(false)}
        />
      ) : (
        <ApprovalOptions options={options} onSelect={handleSelect} />
      )}
    </section>
  )
}
