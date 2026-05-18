import { useEffect, useRef, useState } from 'react'
import { invoke } from '@tauri-apps/api/core'
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
  sendUserMessage: (
    text: string,
    images?: Array<{ media_type: string; data: string }>,
  ) => Promise<void>
  cycleMode: () => void
  slashCommands?: SlashCommand[]
  model?: string | null
  onInterrupt?: () => void
  busy?: boolean
  projectPath?: string
}

interface PendingImage {
  id: string
  mediaType: string
  data: string // base64 (no prefix)
  previewUrl: string // data: URL
}

interface MentionState {
  startIndex: number
  query: string
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
  projectPath,
}: Props) {
  const [value, setValue] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [showSlash, setShowSlash] = useState(false)
  const [mention, setMention] = useState<MentionState | null>(null)
  const [mentionResults, setMentionResults] = useState<string[]>([])
  const [pendingImages, setPendingImages] = useState<PendingImage[]>([])
  const textareaRef = useRef<HTMLTextAreaElement | null>(null)
  const isComposingRef = useRef(false)

  const submit = async () => {
    if (!value && pendingImages.length === 0) return
    const snapshot = value
    const images = pendingImages.map((p) => ({
      media_type: p.mediaType,
      data: p.data,
    }))
    setError(null)
    try {
      await sendUserMessage(snapshot, images.length > 0 ? images : undefined)
      setValue('')
      setPendingImages([])
      setShowSlash(false)
      setMention(null)
    } catch (e) {
      setError(String(e))
    }
  }

  const ingestFile = async (file: File): Promise<PendingImage | null> => {
    if (!file.type.startsWith('image/')) return null
    const buf = await file.arrayBuffer()
    const bytes = new Uint8Array(buf)
    let binary = ''
    for (let i = 0; i < bytes.byteLength; i++) binary += String.fromCharCode(bytes[i])
    const base64 = btoa(binary)
    return {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      mediaType: file.type,
      data: base64,
      previewUrl: `data:${file.type};base64,${base64}`,
    }
  }

  const onPaste = async (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const items = Array.from(e.clipboardData?.items ?? [])
    const images = items.filter((i) => i.kind === 'file' && i.type.startsWith('image/'))
    if (images.length === 0) return
    e.preventDefault()
    for (const item of images) {
      const file = item.getAsFile()
      if (!file) continue
      const img = await ingestFile(file)
      if (img) setPendingImages((prev) => [...prev, img])
    }
  }

  const onDrop = async (e: React.DragEvent<HTMLTextAreaElement>) => {
    const files = Array.from(e.dataTransfer.files ?? [])
    const images = files.filter((f) => f.type.startsWith('image/'))
    if (images.length === 0) return
    e.preventDefault()
    for (const f of images) {
      const img = await ingestFile(f)
      if (img) setPendingImages((prev) => [...prev, img])
    }
  }

  const removeImage = (id: string) => {
    setPendingImages((prev) => prev.filter((p) => p.id !== id))
  }

  const detectMention = (text: string, caret: number): MentionState | null => {
    if (caret === 0) return null
    let i = caret - 1
    while (i >= 0) {
      const ch = text[i]
      if (ch === '@') {
        const before = i === 0 ? ' ' : text[i - 1]
        if (before === ' ' || before === '\n' || i === 0) {
          return { startIndex: i, query: text.slice(i + 1, caret) }
        }
        return null
      }
      if (ch === ' ' || ch === '\n' || ch === '\t') return null
      i--
    }
    return null
  }

  useEffect(() => {
    if (!mention || !projectPath) {
      setMentionResults([])
      return
    }
    let alive = true
    const run = async () => {
      try {
        const results = await invoke<string[]>('search_files', {
          args: { project_path: projectPath, query: mention.query },
        })
        if (alive) setMentionResults(results)
      } catch {
        if (alive) setMentionResults([])
      }
    }
    run()
    return () => {
      alive = false
    }
  }, [mention, projectPath])

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (
      isComposingRef.current ||
      e.keyCode === 229 ||
      (e.nativeEvent as KeyboardEvent).isComposing
    ) {
      return
    }
    if (mention && mentionResults.length > 0 && e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      onSelectMention(mentionResults[0])
      return
    }
    if (e.key === 'Tab' && e.shiftKey) {
      e.preventDefault()
      cycleMode()
      return
    }
    if (e.key === 'Escape') {
      if (mention) {
        e.preventDefault()
        setMention(null)
        return
      }
      if (busy && onInterrupt) {
        e.preventDefault()
        onInterrupt()
        return
      }
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
    const caret = e.target.selectionStart ?? v.length
    setValue(v)
    setShowSlash(v.startsWith('/'))
    setMention(detectMention(v, caret))
  }

  const onSelectSlash = (cmd: string) => {
    setValue(cmd + ' ')
    setShowSlash(false)
  }

  const onSelectMention = (path: string) => {
    if (!mention) return
    const before = value.slice(0, mention.startIndex)
    const after = value.slice(mention.startIndex + 1 + mention.query.length)
    const inserted = `@${path} `
    const next = before + inserted + after
    setValue(next)
    setMention(null)
    const ta = textareaRef.current
    if (ta) {
      const pos = (before + inserted).length
      requestAnimationFrame(() => {
        ta.focus()
        ta.setSelectionRange(pos, pos)
      })
    }
  }

  return (
    <div className="chat-composer">
      {error && (
        <div role="alert" className="chat-composer__error">
          {error}
        </div>
      )}
      {showSlash && allSlashes.length > 0 && !mention && (
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
      {mention && mentionResults.length > 0 && (
        <ul className="chat-composer__mention" role="listbox">
          {mentionResults.slice(0, 12).map((p) => (
            <li key={p}>
              <button type="button" onClick={() => onSelectMention(p)}>
                <span className="chat-composer__mention-path">{p}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {pendingImages.length > 0 && (
        <div className="chat-composer__attachments">
          {pendingImages.map((img) => (
            <div key={img.id} className="chat-composer__attachment">
              <img src={img.previewUrl} alt="첨부 이미지" />
              <button
                type="button"
                className="chat-composer__attachment-remove"
                onClick={() => removeImage(img.id)}
                aria-label="이미지 제거"
                title="제거"
              >
                ×
              </button>
            </div>
          ))}
        </div>
      )}
      <div className="chat-composer__row">
        <textarea
          ref={textareaRef}
          className="chat-composer__textarea"
          value={value}
          disabled={disabled}
          onChange={onChange}
          onKeyDown={onKeyDown}
          onPaste={onPaste}
          onDrop={onDrop}
          onDragOver={(e) => e.preventDefault()}
          onCompositionStart={() => {
            isComposingRef.current = true
          }}
          onCompositionEnd={() => {
            isComposingRef.current = false
          }}
          placeholder={
            disabled
              ? '도구 승인을 먼저 처리하세요…'
              : '메시지를 입력하세요 (Enter 전송 · Shift+Enter 줄바꿈 · @로 파일 · 이미지 paste/drop 지원)'
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
