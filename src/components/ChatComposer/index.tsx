import { useRef, useState } from 'react'
import type { Mode } from '../../types'
import './ChatComposer.css'

const SLASH_COMMANDS = ['/help', '/clear', '/model', '/cost', '/compact']

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
}

export function ChatComposer({
  mode,
  disabled,
  sendUserMessage,
  cycleMode,
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
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      submit()
    }
  }

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
      {showSlash && (
        <ul className="chat-composer__slash" role="listbox">
          {SLASH_COMMANDS.filter((c) => c.startsWith(value)).map((c) => (
            <li key={c}>
              <button type="button" onClick={() => onSelectSlash(c)}>
                {c}
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
          <button type="button" onClick={() => cycleMode()}>
            Shift+Tab
          </button>
        </div>
      </div>
      <div className="chat-composer__status" data-mode={mode}>
        {MODE_LABEL[mode]}
      </div>
    </div>
  )
}
