import { useEffect, useMemo, useRef, useState } from 'react'
import type { ToolRequest } from '../../types'
import { AskUserQuestionCard, type AskInput } from '../AskUserQuestionCard'
import { DiffView } from '../DiffView'
import { Icon } from '../Icon'
import './ToolApprovalCard.css'

interface Props {
  request: ToolRequest
  onRespond: (
    allow: boolean,
    updatedInput?: unknown,
    denialMessage?: string | null,
  ) => void
}

interface EditPreview {
  filePath: string
  oldText: string
  newText: string
  kind: 'edit' | 'write' | 'multiedit' | 'notebookedit'
  /** Total edit count for MultiEdit; 1 for single Edit/Write. */
  parts: number
}

function pickString(input: unknown, key: string): string {
  if (!input || typeof input !== 'object') return ''
  const v = (input as Record<string, unknown>)[key]
  return typeof v === 'string' ? v : ''
}

function pickArray(input: unknown, key: string): unknown[] {
  if (!input || typeof input !== 'object') return []
  const v = (input as Record<string, unknown>)[key]
  return Array.isArray(v) ? v : []
}

function extractPreview(req: ToolRequest): EditPreview | null {
  const input = req.input
  if (!input || typeof input !== 'object') return null
  const filePath = pickString(input, 'file_path')
  switch (req.tool_name) {
    case 'Edit': {
      if (!filePath) return null
      return {
        filePath,
        oldText: pickString(input, 'old_string'),
        newText: pickString(input, 'new_string'),
        kind: 'edit',
        parts: 1,
      }
    }
    case 'Write': {
      if (!filePath) return null
      return {
        filePath,
        oldText: '',
        newText: pickString(input, 'content'),
        kind: 'write',
        parts: 1,
      }
    }
    case 'MultiEdit': {
      if (!filePath) return null
      const edits = pickArray(input, 'edits') as Array<{
        old_string?: string
        new_string?: string
      }>
      // Concatenate every old/new pair so the user sees the full set of
      // changes in a single diff. Hunks are separated by a marker line so
      // the diff isn't misread as one giant block.
      const oldText = edits
        .map((e) => (typeof e.old_string === 'string' ? e.old_string : ''))
        .join('\n')
      const newText = edits
        .map((e) => (typeof e.new_string === 'string' ? e.new_string : ''))
        .join('\n')
      return {
        filePath,
        oldText,
        newText,
        kind: 'multiedit',
        parts: edits.length,
      }
    }
    case 'NotebookEdit': {
      const nbPath = pickString(input, 'notebook_path')
      if (!nbPath) return null
      return {
        filePath: nbPath,
        oldText: '',
        newText: pickString(input, 'new_source'),
        kind: 'notebookedit',
        parts: 1,
      }
    }
    default:
      return null
  }
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

type ApprovalKey = 'allow' | 'allow-always' | 'deny' | 'deny-with-message'

interface ApprovalOption {
  key: ApprovalKey
  label: string
  description?: string
}

function buildOptions(request: ToolRequest): ApprovalOption[] {
  const opts: ApprovalOption[] = [
    { key: 'allow', label: '예 (한 번 허용)', description: '이번 호출만 진행한다.' },
  ]
  // Surface an "always" option only when the backend offered a permission
  // suggestion that promotes to a persistent allow rule. The label echoes
  // the suggestion's own description so the user knows what's being saved.
  const suggestion = request.permission_suggestions?.find(
    (s) => s.type === 'addRules' || s.type === 'allow' || s.type === 'session',
  )
  if (suggestion) {
    opts.push({
      key: 'allow-always',
      label:
        suggestion.label ||
        `예 + 다시 묻지 않음 (${request.tool_name})`,
      description:
        suggestion.reason ||
        suggestion.ruleContent ||
        '이 도구에 대해 항상 허용한다.',
    })
  }
  opts.push({
    key: 'deny',
    label: '거부',
    description: 'Claude에게 이 작업을 취소하라고 알린다.',
  })
  // Mirrors the CLI plugin's "No, and tell Claude what to do differently" —
  // the user explains why and Claude sees that as the denial reason.
  opts.push({
    key: 'deny-with-message',
    label: '거부 + 의견 전달',
    description: 'Claude에게 다르게 해야 할 점을 설명한다.',
  })
  return opts
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
          <Icon name={preview ? 'pencil' : 'gear'} />
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
        <div className="tool-approval-card__reason">
          <Icon name="info" />
          <span>{request.decision_reason}</span>
        </div>
      )}
      {request.blocked_path && (
        <div className="tool-approval-card__blocked">
          <Icon name="block" />
          <span>{request.blocked_path}</span>
        </div>
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
