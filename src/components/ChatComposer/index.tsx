import { useEffect, useRef, useState } from 'react'
import { invoke } from '@tauri-apps/api/core'
import type { Mode, SlashCommand } from '../../types'
import {
  CLIENT_SLASH_COMMANDS,
  decorateServerSlash,
} from '../../hooks/clientSlash'
import './ChatComposer.css'

// Commands MeeCode dispatches without sending anything to the CLI. See
// `hooks/clientSlash.ts` for the dispatch logic; this list just drives
// the suggestion menu so the same commands appear in both places.
const CLIENT_SIDE_SLASH: ReadonlyArray<{ name: string; description?: string }> =
  CLIENT_SLASH_COMMANDS

// Pre-`session:init` fallback for the CLI-dispatched built-ins. These
// run via the CLI's own slash-command dispatcher when forwarded as user
// text in stream-json mode (verified: `/init`, `/compact`, `/context`,
// `/review`, `/security-review`). Once `session:init` arrives, the
// authoritative list from the running session takes over — which also
// includes plugin/skill commands like `superpowers:execute-plan`.
const FALLBACK_SLASH: ReadonlyArray<{ name: string; description?: string }> = [
  { name: '/init', description: '프로젝트 초기화 (CLAUDE.md 생성)' },
  { name: '/compact', description: '대화 압축' },
  { name: '/context', description: '컨텍스트 현황' },
  { name: '/review', description: '코드 리뷰' },
  { name: '/security-review', description: '보안 리뷰' },
]

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
  recentUserTexts?: string[]
  onClearConversation?: () => void
  pendingContext?: { id: number; text: string } | null
  onContextConsumed?: () => void
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
  recentUserTexts,
  onClearConversation,
  pendingContext,
  onContextConsumed,
}: Props) {
  const [value, setValue] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [showSlash, setShowSlash] = useState(false)
  const [slashIdx, setSlashIdx] = useState(0)
  const [mention, setMention] = useState<MentionState | null>(null)
  const [mentionResults, setMentionResults] = useState<string[]>([])
  const [mentionIdx, setMentionIdx] = useState(0)
  const [pendingImages, setPendingImages] = useState<PendingImage[]>([])
  const [historyIdx, setHistoryIdx] = useState<number | null>(null)
  const textareaRef = useRef<HTMLTextAreaElement | null>(null)
  const isComposingRef = useRef(false)
  const slashListRef = useRef<HTMLUListElement | null>(null)
  const mentionListRef = useRef<HTMLUListElement | null>(null)
  const lastContextIdRef = useRef<number | null>(null)

  useEffect(() => {
    if (!pendingContext) return
    if (lastContextIdRef.current === pendingContext.id) return
    lastContextIdRef.current = pendingContext.id
    setValue((v) => {
      const sep = v && !v.endsWith('\n') ? '\n' : ''
      return v + sep + pendingContext.text
    })
    requestAnimationFrame(() => {
      const ta = textareaRef.current
      if (ta) {
        ta.focus()
        ta.setSelectionRange(ta.value.length, ta.value.length)
      }
    })
    onContextConsumed?.()
  }, [pendingContext, onContextConsumed])

  useEffect(() => {
    if (!showSlash) return
    const list = slashListRef.current
    if (!list) return
    const item = list.children[slashIdx] as HTMLElement | undefined
    if (item && typeof item.scrollIntoView === 'function') {
      item.scrollIntoView({ block: 'nearest' })
    }
  }, [slashIdx, showSlash])

  useEffect(() => {
    if (!mention) return
    const list = mentionListRef.current
    if (!list) return
    const item = list.children[mentionIdx] as HTMLElement | undefined
    if (item && typeof item.scrollIntoView === 'function') {
      item.scrollIntoView({ block: 'nearest' })
    }
  }, [mentionIdx, mention])

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

  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const openFilePicker = () => {
    fileInputRef.current?.click()
  }
  const onFileInputChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? [])
    for (const f of files) {
      const img = await ingestFile(f)
      if (img) setPendingImages((prev) => [...prev, img])
    }
    e.target.value = ''
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
    // Slash command palette navigation takes priority.
    if (showSlash && allSlashes.length > 0 && !mention) {
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        setSlashIdx((i) => Math.min(i + 1, allSlashes.length - 1))
        return
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault()
        setSlashIdx((i) => Math.max(i - 1, 0))
        return
      }
      if ((e.key === 'Enter' && !e.shiftKey) || e.key === 'Tab') {
        e.preventDefault()
        const pick = allSlashes[Math.min(slashIdx, allSlashes.length - 1)]
        if (pick) onSelectSlash(pick.name)
        return
      }
      if (e.key === 'Escape') {
        e.preventDefault()
        setShowSlash(false)
        return
      }
    }
    // Mention palette navigation.
    if (mention && mentionResults.length > 0) {
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        setMentionIdx((i) => Math.min(i + 1, mentionResults.length - 1))
        return
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault()
        setMentionIdx((i) => Math.max(i - 1, 0))
        return
      }
      if ((e.key === 'Enter' && !e.shiftKey) || e.key === 'Tab') {
        e.preventDefault()
        const pick = mentionResults[Math.min(mentionIdx, mentionResults.length - 1)]
        if (pick) onSelectMention(pick)
        return
      }
    }
    if (e.key === 'Tab' && e.shiftKey) {
      e.preventDefault()
      cycleMode()
      return
    }
    if ((e.ctrlKey || e.metaKey) && (e.key === 'l' || e.key === 'L') && onClearConversation) {
      e.preventDefault()
      onClearConversation()
      return
    }
    if (
      e.key === 'ArrowUp' &&
      !e.shiftKey &&
      recentUserTexts &&
      recentUserTexts.length > 0 &&
      value === '' &&
      historyIdx === null
    ) {
      e.preventDefault()
      const lastIdx = recentUserTexts.length - 1
      setHistoryIdx(lastIdx)
      setValue(recentUserTexts[lastIdx])
      return
    }
    if (e.key === 'ArrowUp' && historyIdx !== null && historyIdx > 0) {
      e.preventDefault()
      const next = historyIdx - 1
      setHistoryIdx(next)
      setValue(recentUserTexts![next])
      return
    }
    if (e.key === 'ArrowDown' && historyIdx !== null) {
      e.preventDefault()
      if (historyIdx < (recentUserTexts?.length ?? 0) - 1) {
        const next = historyIdx + 1
        setHistoryIdx(next)
        setValue(recentUserTexts![next])
      } else {
        setHistoryIdx(null)
        setValue('')
      }
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
    const seen = new Set<string>()
    const out: SlashCommand[] = []
    // Client-wired commands always present, with our own descriptions.
    for (const c of CLIENT_SIDE_SLASH) {
      if (seen.has(c.name)) continue
      seen.add(c.name)
      out.push(c)
    }
    // Dynamic list from session:init is the authoritative source of what
    // the running CLI actually dispatches (plugin skills, user skills,
    // built-ins). It supersedes the fallback once it arrives. The CLI
    // doesn't serialize descriptions, so `decorateServerSlash` fills
    // them in for the well-known built-ins; plugin/skill commands keep
    // their bare names.
    for (const c of dynamic) {
      const key = c.name.startsWith('/') ? c.name : '/' + c.name
      if (seen.has(key)) continue
      seen.add(key)
      out.push(decorateServerSlash({ ...c, name: key }))
    }
    // Pre-init fallback so the menu has useful entries on the first frame.
    if (dynamic.length === 0) {
      for (const c of FALLBACK_SLASH) {
        if (seen.has(c.name)) continue
        seen.add(c.name)
        out.push(c)
      }
    }
    const q = value.trim().toLowerCase()
    if (!q.startsWith('/')) return []
    return out.filter((c) => c.name.toLowerCase().startsWith(q))
  })()

  const onChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const v = e.target.value
    const caret = e.target.selectionStart ?? v.length
    setValue(v)
    setShowSlash(v.startsWith('/'))
    setSlashIdx(0)
    setMention(detectMention(v, caret))
    setMentionIdx(0)
    setHistoryIdx(null)
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
        <ul ref={slashListRef} className="chat-composer__slash" role="listbox">
          {allSlashes.map((c, i) => (
            <li key={c.name}>
              <button
                type="button"
                className={
                  'chat-composer__slash-item' +
                  (i === slashIdx ? ' is-selected' : '')
                }
                onMouseEnter={() => setSlashIdx(i)}
                onClick={() => onSelectSlash(c.name)}
              >
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
        <ul ref={mentionListRef} className="chat-composer__mention" role="listbox">
          {mentionResults.slice(0, 20).map((p, i) => (
            <li key={p}>
              <button
                type="button"
                className={
                  'chat-composer__mention-item' +
                  (i === mentionIdx ? ' is-selected' : '')
                }
                onMouseEnter={() => setMentionIdx(i)}
                onClick={() => onSelectMention(p)}
              >
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
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            multiple
            style={{ display: 'none' }}
            onChange={onFileInputChange}
          />
          <button
            type="button"
            onClick={openFilePicker}
            title="이미지 첨부"
            aria-label="이미지 첨부"
          >
            🖼
          </button>
          {onInterrupt && (
            <button
              type="button"
              className={
                'chat-composer__interrupt' +
                (busy ? ' is-active' : ' is-idle')
              }
              onClick={busy ? onInterrupt : undefined}
              disabled={!busy}
              title={busy ? '진행 중인 작업 취소 (ESC)' : '진행 중인 작업 없음'}
              aria-label="진행 중인 작업 중단"
            >
              <span className="chat-composer__interrupt-icon" aria-hidden="true">
                ⛔
              </span>
              <span className="chat-composer__interrupt-label">중단</span>
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
