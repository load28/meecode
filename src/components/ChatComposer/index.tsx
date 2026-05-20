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

// Pre-`session:init` fallback for the CLI-dispatched built-ins.
const FALLBACK_SLASH: ReadonlyArray<{ name: string; description?: string }> = [
  { name: '/init', description: '프로젝트 초기화 (CLAUDE.md 생성)' },
  { name: '/compact', description: '대화 압축' },
  { name: '/context', description: '컨텍스트 현황' },
  { name: '/review', description: '코드 리뷰' },
  { name: '/security-review', description: '보안 리뷰' },
]

const MODE_LABEL: Record<Mode, string> = {
  default: '⏎ 기본',
  plan: '📋 Plan',
  'auto-accept': '⚡ Auto',
}

const MODEL_DISPLAY_NAME = (model: string | null | undefined): string => {
  if (!model) return '기본'
  if (model.includes('opus')) return 'Opus 4.7'
  if (model.includes('sonnet')) return 'Sonnet 4.6'
  if (model.includes('haiku')) return 'Haiku 4.5'
  return model
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
  claudeReady?: boolean
  onOpenSettings?: () => void
}

interface PendingImage {
  id: string
  mediaType: string
  data: string
  previewUrl: string
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
  claudeReady = true,
  onOpenSettings,
}: Props) {
  const composerDisabled = (disabled && !busy) || !claudeReady
  const [value, setValue] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [showSlash, setShowSlash] = useState(false)
  const [slashIdx, setSlashIdx] = useState(0)
  const [mention, setMention] = useState<MentionState | null>(null)
  const [mentionResults, setMentionResults] = useState<string[]>([])
  const [mentionIdx, setMentionIdx] = useState(0)
  const [pendingImages, setPendingImages] = useState<PendingImage[]>([])
  const [historyIdx, setHistoryIdx] = useState<number | null>(null)
  const [escHint, setEscHint] = useState(false)
  const textareaRef = useRef<HTMLTextAreaElement | null>(null)
  const isComposingRef = useRef(false)
  const slashListRef = useRef<HTMLUListElement | null>(null)
  const mentionListRef = useRef<HTMLUListElement | null>(null)
  const lastContextIdRef = useRef<number | null>(null)
  // Double-press ESC window — matches the CLI's useDoublePress for input
  // clear. First ESC arms the action and shows a hint, second ESC within
  // the window clears and saves to history.
  const escArmedAtRef = useRef<number | null>(null)
  const ESC_DOUBLE_PRESS_MS = 1000

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

  // Auto-grow the textarea up to a max height.
  useEffect(() => {
    const ta = textareaRef.current
    if (!ta) return
    ta.style.height = 'auto'
    const next = Math.min(ta.scrollHeight, 280)
    ta.style.height = next + 'px'
  }, [value])

  // Global ESC interrupt — fires when focus is NOT on the textarea, so
  // ESC still cancels a turn even when the user clicked elsewhere (a
  // tool-approval card, the file panel, etc.). Skip when the event target
  // is the textarea itself: that path runs through the local onKeyDown
  // (which also handles slash/mention palette dismissal first).
  useEffect(() => {
    if (!busy || !onInterrupt) return
    const handler = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      if (isComposingRef.current) return
      if (e.target === textareaRef.current) return
      e.preventDefault()
      onInterrupt()
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [busy, onInterrupt])

  const submit = async () => {
    // CLI parity: trim trailing whitespace before submit. Empty input with
    // no attachments is a no-op (matches `onSubmit` in PromptInput.tsx).
    const trimmed = value.trimEnd()
    if (!trimmed && pendingImages.length === 0) return
    const images = pendingImages.map((p) => ({
      media_type: p.mediaType,
      data: p.data,
    }))
    setError(null)
    try {
      await sendUserMessage(trimmed, images.length > 0 ? images : undefined)
      setValue('')
      setPendingImages([])
      setShowSlash(false)
      setMention(null)
      setHistoryIdx(null)
    } catch (e) {
      setError(String(e))
    }
  }

  // Cursor positional helpers — used by Up/Down to decide between in-text
  // cursor movement (the textarea's native behavior) and history paging.
  // Matches the CLI's useTextInput up/downOrHistory: only fall through to
  // history when the cursor genuinely can't move further within the text.
  const isCursorAtFirstLine = (): boolean => {
    const ta = textareaRef.current
    if (!ta) return true
    const caret = ta.selectionStart ?? 0
    return value.indexOf('\n') === -1 || value.lastIndexOf('\n', caret - 1) === -1
  }
  const isCursorAtLastLine = (): boolean => {
    const ta = textareaRef.current
    if (!ta) return true
    const caret = ta.selectionEnd ?? value.length
    return value.indexOf('\n', caret) === -1
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
    // IME guard — only block Enter-like keys during composition. ESC must
    // still pass through so we can cancel composition + interrupt.
    const composing =
      isComposingRef.current ||
      e.keyCode === 229 ||
      (e.nativeEvent as KeyboardEvent).isComposing
    if (composing && e.key !== 'Escape') {
      return
    }
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
    // History navigation — only when cursor genuinely can't move further
    // within the textarea. Mirrors CLI useTextInput.upOrHistoryUp /
    // downOrHistoryDown so multi-line drafts behave as users expect.
    if (
      e.key === 'ArrowUp' &&
      !e.shiftKey &&
      recentUserTexts &&
      recentUserTexts.length > 0 &&
      historyIdx === null &&
      isCursorAtFirstLine()
    ) {
      e.preventDefault()
      const lastIdx = recentUserTexts.length - 1
      setHistoryIdx(lastIdx)
      setValue(recentUserTexts[lastIdx])
      return
    }
    if (e.key === 'ArrowUp' && historyIdx !== null && historyIdx > 0 && isCursorAtFirstLine()) {
      e.preventDefault()
      const next = historyIdx - 1
      setHistoryIdx(next)
      setValue(recentUserTexts![next])
      return
    }
    if (e.key === 'ArrowDown' && historyIdx !== null && isCursorAtLastLine()) {
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
        escArmedAtRef.current = null
        setEscHint(false)
        return
      }
      // While the agent is busy, ESC always interrupts first (CLI parity:
      // PromptInput.tsx treats key.escape during loading as the cancel
      // shortcut). The double-press clear is only available when idle.
      if (busy && onInterrupt) {
        e.preventDefault()
        onInterrupt()
        escArmedAtRef.current = null
        setEscHint(false)
        return
      }
      // Double-press ESC to clear (CLI's useTextInput handleEscape via
      // useDoublePress): first press arms + shows hint, second press
      // within the window clears the input and saves it to history.
      if (value.length > 0) {
        e.preventDefault()
        const now = Date.now()
        const armedAt = escArmedAtRef.current
        if (armedAt !== null && now - armedAt <= ESC_DOUBLE_PRESS_MS) {
          escArmedAtRef.current = null
          setEscHint(false)
          setValue('')
          setHistoryIdx(null)
        } else {
          escArmedAtRef.current = now
          setEscHint(true)
          window.setTimeout(() => {
            if (escArmedAtRef.current === now) {
              escArmedAtRef.current = null
              setEscHint(false)
            }
          }, ESC_DOUBLE_PRESS_MS)
        }
        return
      }
    }
    if (e.key === 'Enter' && !e.shiftKey && !e.metaKey && !e.altKey && !composing) {
      // Backslash+Enter inserts a newline (CLI parity, useTextInput
      // handleEnter): when the char immediately before the caret is `\`,
      // consume that backslash and insert a `\n` instead of submitting.
      const ta = textareaRef.current
      const caret = ta?.selectionStart ?? value.length
      if (caret > 0 && value[caret - 1] === '\\') {
        e.preventDefault()
        const next = value.slice(0, caret - 1) + '\n' + value.slice(caret)
        setValue(next)
        requestAnimationFrame(() => {
          if (ta) {
            ta.focus()
            ta.setSelectionRange(caret, caret)
          }
        })
        return
      }
      e.preventDefault()
      submit()
      return
    }
    // Alt/Meta+Enter inserts a newline like Shift+Enter. The browser's
    // default Shift+Enter behavior already inserts a newline, but Alt/Meta
    // doesn't — handle it explicitly to match the CLI.
    if (e.key === 'Enter' && (e.altKey || e.metaKey) && !composing) {
      e.preventDefault()
      const ta = textareaRef.current
      const caret = ta?.selectionStart ?? value.length
      const next = value.slice(0, caret) + '\n' + value.slice(caret)
      setValue(next)
      requestAnimationFrame(() => {
        if (ta) {
          ta.focus()
          ta.setSelectionRange(caret + 1, caret + 1)
        }
      })
      return
    }
  }

  const allSlashes: SlashCommand[] = (() => {
    const dynamic = slashCommands ?? []
    const seen = new Set<string>()
    const out: SlashCommand[] = []
    for (const c of CLIENT_SIDE_SLASH) {
      if (seen.has(c.name)) continue
      seen.add(c.name)
      out.push(c)
    }
    for (const c of dynamic) {
      const key = c.name.startsWith('/') ? c.name : '/' + c.name
      if (seen.has(key)) continue
      seen.add(key)
      out.push(decorateServerSlash({ ...c, name: key }))
    }
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
    // Any further typing disarms the double-ESC clear (CLI parity).
    if (escArmedAtRef.current !== null) {
      escArmedAtRef.current = null
      setEscHint(false)
    }
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

  const hasContent = value.trim().length > 0 || pendingImages.length > 0
  const sendDisabled = busy ? false : disabled || !hasContent
  const onSendClick = () => {
    if (busy && onInterrupt) {
      onInterrupt()
      return
    }
    submit()
  }

  return (
    <div className="chat-composer">
      {error && (
        <div role="alert" className="chat-composer__error">
          {error}
        </div>
      )}
      {escHint && !busy && (
        <div className="chat-composer__esc-hint" aria-live="polite">
          Esc 한 번 더 누르면 입력이 지워집니다
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
      <div
        className={
          'chat-composer__card' + (disabled && !busy ? ' is-disabled' : '')
        }
      >
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
        <textarea
          ref={textareaRef}
          className="chat-composer__textarea"
          value={value}
          disabled={composerDisabled}
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
            !claudeReady
              ? 'Claude CLI 경로를 먼저 설정해주세요…'
              : disabled && !busy
              ? '도구 승인을 먼저 처리하세요…'
              : 'Claude에게 메시지 보내기…'
          }
          rows={1}
        />
        <div className="chat-composer__toolbar">
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
            className="chat-composer__icon-btn"
            onClick={openFilePicker}
            title="이미지 첨부"
            aria-label="이미지 첨부"
            disabled={disabled && !busy}
          >
            📎
          </button>
          <button
            type="button"
            className="chat-composer__chip"
            data-mode={mode}
            onClick={() => cycleMode()}
            title="모드 전환 (Shift+Tab)"
          >
            <span>{MODE_LABEL[mode]}</span>
            <span className="chat-composer__chip-shortcut">⇧⇥</span>
          </button>
          <span className="chat-composer__chip chat-composer__chip-model" title="현재 모델">
            {MODEL_DISPLAY_NAME(model)}
          </span>
          <div className="chat-composer__toolbar-spacer" />
          <button
            type="button"
            className={'chat-composer__send' + (busy ? ' is-stop' : '')}
            onClick={onSendClick}
            disabled={sendDisabled}
            title={
              busy
                ? '진행 중인 작업 중단 (ESC)'
                : hasContent
                ? '전송 (Enter)'
                : '메시지를 입력하세요'
            }
            aria-label={busy ? '진행 중인 작업 중단' : '메시지 전송'}
          >
            <span className="chat-composer__send-icon" aria-hidden="true">
              {busy ? '■' : '↑'}
            </span>
          </button>
        </div>
      </div>
      {!claudeReady && (
        <div className="chat-composer__claude-warning" role="status">
          <span>Claude CLI 경로가 설정되어 있지 않거나 무효합니다.</span>
          {onOpenSettings && (
            <button
              type="button"
              className="chat-composer__claude-warning-btn"
              onClick={onOpenSettings}
            >
              설정 열기
            </button>
          )}
        </div>
      )}
    </div>
  )
}
