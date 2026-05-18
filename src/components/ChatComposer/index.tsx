import { useRef, useState } from 'react'
import type { Mode, SlashCommand } from '../../types'
import './ChatComposer.css'

const BUILTIN_SLASH = ['/help', '/clear', '/model', '/cost', '/compact', '/resume']

const MODE_LABEL: Record<Mode, string> = {
  default: '⏎ 기본 모드',
  plan: '📋 Plan 모드',
  'auto-accept': '⚡ Auto-accept 모드',
}

interface Props {
  mode: Mode
  disabled: boolean
  sendUserMessage: (text: string) => Promise<void>
  cycleMode: () => void
  slashCommands?: SlashCommand[]
  model?: string | null
  onInterrupt?: () => void
  busy?: boolean
}

export function ChatComposer({
  mode,
  disabled,
  sendUserMessage,
  cycleMode,
  slashCommands,
  model,
  onInterrupt,
  busy,
}: Props) {
  const [value, setValue] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [showSlash, setShowSlash] = useState(false)
  const isComposingRef = useRef(false)

  const submit = async () => {
    if (!value) return
    const snapshot = value
    setError(null)
    try {
      await sendUserMessage(snapshot)
      setValue('')
      setShowSlash(false)
    } catch (e) {
      setError(String(e))
    }
  }

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (
      isComposingRef.current ||
      e.keyCode === 229 ||
      (e.nativeEvent as KeyboardEvent).isComposing
    ) {
      return
    }
    if (e.key === 'Tab' && e.shiftKey) {
      e.preventDefault()
      cycleMode()
      return
    }
    if (e.key === 'Escape' && busy && onInterrupt) {
      e.preventDefault()
      onInterrupt()
      return
    }
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      submit()
    }
  }

  const allSlashes: SlashCommand[] = (() => {
    const dynamic = slashCommands ?? []
    const builtins = BUILTIN_SLASH.map((n) => ({ name: n }))
    const seen = new Set<string>()
    const out: SlashCommand[] = []
    for (const c of [...dynamic, ...builtins]) {
      const key = c.name.startsWith('/') ? c.name : '/' + c.name
      if (seen.has(key)) continue
      seen.add(key)
      out.push({ ...c, name: key })
    }
    return out.filter((c) => c.name.startsWith(value))
  })()

  const onChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const v = e.target.value
    setValue(v)
    setShowSlash(v.startsWith('/'))
  }

  const onSelectSlash = (cmd: string) => {
    setValue(cmd + ' ')
    setShowSlash(false)
  }

  return (
    <div className="chat-composer">
      {error && (
        <div role="alert" className="chat-composer__error">
          {error}
        </div>
      )}
      {showSlash && allSlashes.length > 0 && (
        <ul className="chat-composer__slash" role="listbox">
          {allSlashes.slice(0, 10).map((c) => (
            <li key={c.name}>
              <button type="button" onClick={() => onSelectSlash(c.name)}>
                <span className="chat-composer__slash-name">{c.name}</span>
                {c.description && (
                  <span className="chat-composer__slash-desc">{c.description}</span>
                )}
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="chat-composer__row">
        <textarea
          className="chat-composer__textarea"
          value={value}
          disabled={disabled}
          onChange={onChange}
          onKeyDown={onKeyDown}
          onCompositionStart={() => {
            isComposingRef.current = true
          }}
          onCompositionEnd={() => {
            isComposingRef.current = false
          }}
          placeholder={
            disabled
              ? '도구 승인을 먼저 처리하세요…'
              : '메시지를 입력하세요 (Enter 전송 · Shift+Enter 줄바꿈)'
          }
          rows={2}
        />
        <div className="chat-composer__buttons">
          {busy && onInterrupt && (
            <button
              type="button"
              className="chat-composer__interrupt"
              onClick={onInterrupt}
              title="진행 중인 작업 취소 (ESC)"
            >
              ⛔ 중단
            </button>
          )}
          <button type="button" onClick={() => cycleMode()}>
            Shift+Tab
          </button>
        </div>
      </div>
      <div className="chat-composer__status" data-mode={mode}>
        <span>{MODE_LABEL[mode]}</span>
        {model && <span className="chat-composer__model">· {model}</span>}
      </div>
    </div>
  )
}
