import { useEffect, useMemo, useRef, useState } from 'react'
import type { ToolRequest } from '../../types'
import { AskUserQuestionCard, type AskInput } from '../AskUserQuestionCard'
import { DiffView } from '../DiffView'
import { extractPreview, summarize } from './preview'
import { buildOptions, type ApprovalKey } from './options'
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
  const messageInputRef = useRef<HTMLTextAreaElement | null>(null)
  // When the user picks "거부 + 의견 전달" we expand an inline textarea
  // instead of dispatching immediately. The submit fires only after they
  // press 전송 (or Cmd/Ctrl+Enter), so accidental Enter taps don't send a
  // half-typed message.
  const [denyMessage, setDenyMessage] = useState('')
  const [denyMode, setDenyMode] = useState(false)

  const submitDenyMessage = () => {
    const trimmed = denyMessage.trim()
    if (!trimmed) return
    onRespond(false, undefined, trimmed)
  }

  const handleSelect = (key: ApprovalKey) => {
    if (key === 'deny') {
      onRespond(false)
      return
    }
    if (key === 'deny-with-message') {
      setDenyMode(true)
      // Defer focus until React commits the textarea — using requestAnimationFrame
      // would also work, but a microtask via setTimeout(0) is enough.
      setTimeout(() => messageInputRef.current?.focus(), 0)
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
        <div className="tool-approval-card__deny-form" role="form" aria-label="거부 의견">
          <label className="tool-approval-card__deny-label" htmlFor="deny-message-input">
            Claude에게 전달할 내용 (어떻게 해야 하는지)
          </label>
          <textarea
            id="deny-message-input"
            ref={messageInputRef}
            className="tool-approval-card__deny-input"
            placeholder="예: 이 파일은 수정하지 말고 별도 파일을 만들어줘"
            value={denyMessage}
            onChange={(e) => setDenyMessage(e.target.value)}
            onKeyDown={(e) => {
              // Cmd/Ctrl+Enter submits; plain Enter inserts a newline so
              // multi-line guidance is easy to write.
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                e.preventDefault()
                submitDenyMessage()
              } else if (e.key === 'Escape') {
                e.preventDefault()
                setDenyMode(false)
                setDenyMessage('')
              }
            }}
            rows={3}
          />
          <div className="tool-approval-card__deny-actions">
            <button
              type="button"
              className="tool-approval-card__deny-cancel"
              onClick={() => {
                setDenyMode(false)
                setDenyMessage('')
              }}
            >
              취소
            </button>
            <button
              type="button"
              className="tool-approval-card__deny-submit"
              onClick={submitDenyMessage}
              disabled={!denyMessage.trim()}
              title="Cmd/Ctrl + Enter"
            >
              거부 + 전송
            </button>
          </div>
        </div>
      ) : (
        <>
          <ul className="tool-approval-card__options" role="listbox">
            {options.map((opt, i) => (
              <li
                key={opt.key}
                role="option"
                aria-selected={false}
                className={`tool-approval-card__option tool-approval-card__option--${opt.key}`}
                onClick={() => handleSelect(opt.key)}
              >
                <span className="tool-approval-card__option-marker" aria-hidden="true">
                  {i + 1}
                </span>
                <div className="tool-approval-card__option-body">
                  <div className="tool-approval-card__option-label">{opt.label}</div>
                  {opt.description && (
                    <div className="tool-approval-card__option-desc">{opt.description}</div>
                  )}
                </div>
              </li>
            ))}
          </ul>

          <div className="tool-approval-card__hint-row" aria-hidden="true">
            숫자 키로 선택 · Enter는 허용 · Esc는 거부
          </div>
        </>
      )}
    </section>
  )
}
