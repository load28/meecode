import { useRef, useState } from 'react'
import { invoke } from '@tauri-apps/api/core'
import './ChatComposer.css'

const SLASH_COMMANDS = ['/help', '/clear', '/model', '/cost', '/compact']

const MODES = ['default', 'plan', 'auto-accept'] as const
type Mode = typeof MODES[number]

const MODE_LABEL: Record<Mode, string> = {
  default: '⏎ 기본 모드',
  plan: '📋 Plan 모드',
  'auto-accept': '⚡ Auto-accept 모드',
}

export function ChatComposer() {
  const [value, setValue] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [showSlash, setShowSlash] = useState(false)
  const [mode, setMode] = useState<Mode>('default')
  const isComposingRef = useRef(false)

  const send = async (text: string) => {
    setError(null)
    try {
      await invoke('write_input', { text })
    } catch (e) {
      setError(String(e))
      throw e
    }
  }

  const submit = async () => {
    if (!value) return
    const toSend = value + '\r'
    try {
      await send(toSend)
      setValue('')
    } catch {
      // value remains as-is — user can retry or edit
    }
  }

  const sendShiftTab = () => {
    setMode((prev) => MODES[(MODES.indexOf(prev) + 1) % MODES.length])
    send('\x1b[Z').catch(() => {})
  }

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (isComposingRef.current || e.keyCode === 229 || (e.nativeEvent as KeyboardEvent).isComposing) {
      return
    }
    if (e.key === 'Tab' && e.shiftKey) {
      e.preventDefault()
      sendShiftTab()
      return
    }
    if (e.key === 'Escape') {
      e.preventDefault()
      send('\x1b').catch(() => {})
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

  const handleControl = (text: string) => {
    send(text).catch(() => {
      // send() already called setError; swallow only to suppress unhandled-rejection warning
    })
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
          onChange={onChange}
          onKeyDown={onKeyDown}
          onCompositionStart={() => { isComposingRef.current = true }}
          onCompositionEnd={() => { isComposingRef.current = false }}
          placeholder="메시지를 입력하세요 (Enter 전송 · Shift+Enter 줄바꿈)"
          rows={2}
        />
        <div className="chat-composer__buttons">
          <button type="button" onClick={() => handleControl('\x1b')}>ESC</button>
          <button type="button" onClick={sendShiftTab}>Shift+Tab</button>
          <button type="button" onClick={() => handleControl('\x03')}>Ctrl+C</button>
        </div>
      </div>
      <div className="chat-composer__status" data-mode={mode}>
        {MODE_LABEL[mode]}
      </div>
    </div>
  )
}
