import { useEffect, useMemo, useRef, useState } from 'react'
import type { ToolRequest } from '../../types'
import { AskUserQuestionCard, type AskInput } from '../AskUserQuestionCard'
import { DiffView } from '../DiffView'
import { extractPreview, summarize } from './preview'
import { buildOptions, type ApprovalKey } from './options'
import { ApprovalOptions } from './ApprovalOptions'
import { DenyMessageForm } from './DenyMessageForm'
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

  // Plugin-style keyboard shortcuts: digit selects, Enter = first allow,
  // Esc = deny so the user can decline without reaching for the mouse.
  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const handler = (e: KeyboardEvent) => {
      if (
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement
      ) {
        return
      }
      if (e.key >= '1' && e.key <= '9') {
        const idx = Number(e.key) - 1
        if (idx >= 0 && idx < options.length) {
          e.preventDefault()
          handleSelect(options[idx].key)
        }
      } else if (e.key === 'Enter') {
        e.preventDefault()
        handleSelect(options[0].key)
      } else if (e.key === 'Escape') {
        e.preventDefault()
        handleSelect('deny')
      }
    }
    el.addEventListener('keydown', handler)
    return () => el.removeEventListener('keydown', handler)
    // `handleSelect` is recreated on every render; capturing it via closure
    // is fine because we always want the latest version of `onRespond`.
  })

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
          <span className="tool-approval-card__hint">{preview.parts}개 변경</span>
        )}
      </header>

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
