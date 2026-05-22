import { useEffect, useRef, useState } from 'react'
import { invoke } from '@tauri-apps/api/core'
import type { Mode, SlashCommand } from '../../types'
import {
  CLIENT_SLASH_COMMANDS,
  decorateServerSlash,
} from '../../hooks/clientSlash'
import { useImageAttachments } from '../../hooks/useImageAttachments'
import { useEscapeDoublePress } from '../../hooks/useEscapeDoublePress'
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
  /**
   * Selection (from a Q&A card, expanded pane, or file panel) to attach as
   * an inline-abbreviated placeholder. Each unique `id` is registered once,
   * a `[코멘트 #N +M줄]` token is inserted at the caret, and the full text
   * gets expanded back into a fenced code block on submit — mirroring how
   * Claude Code's `[Pasted text #N +M lines]` placeholders work.
   */
  pendingSelection?: {
    id: number
    text: string
    /** Optional `path:lineStart-lineEnd` shown as a `// ...` comment header. */
    source?: string
  } | null
  onSelectionConsumed?: () => void
  claudeReady?: boolean
  onOpenSettings?: () => void
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
  pendingSelection,
  onSelectionConsumed,
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
  const {
    pendingImages,
    fileInputRef,
    openFilePicker,
    removeImage,
    clear: clearImages,
    onPaste,
    onDrop,
    onFileInputChange,
  } = useImageAttachments()
  const [historyIdx, setHistoryIdx] = useState<number | null>(null)
  const escClear = useEscapeDoublePress()
  const textareaRef = useRef<HTMLTextAreaElement | null>(null)
  const isComposingRef = useRef(false)
  const slashListRef = useRef<HTMLUListElement | null>(null)
  const mentionListRef = useRef<HTMLUListElement | null>(null)
  // Registered selections by their inline number (1-based). The textarea
  // value carries `[코멘트 #N +M줄]` tokens; on submit each token expands
  // back into a fenced code block looked up from this map.
  const selectionsRef = useRef<Map<number, { text: string; source?: string }>>(
    new Map(),
  )
  const selectionCounterRef = useRef(0)
  const lastSelectionIdRef = useRef<number | null>(null)
  useEffect(() => {
    if (!pendingSelection) return
    if (lastSelectionIdRef.current === pendingSelection.id) return
    lastSelectionIdRef.current = pendingSelection.id

    const num = ++selectionCounterRef.current
    selectionsRef.current.set(num, {
      text: pendingSelection.text,
      source: pendingSelection.source,
    })
    const lines = pendingSelection.text.split('\n').length
    const placeholder = `[코멘트 #${num} +${lines}줄]`

    const ta = textareaRef.current
    const caret =
      ta?.selectionStart != null && document.activeElement === ta
        ? ta.selectionStart
        : value.length
    let nextValue = ''
    let nextCaret = caret
    setValue((v) => {
      const before = v.slice(0, caret)
      const after = v.slice(caret)
      const sepBefore =
        before.length > 0 && !before.endsWith(' ') && !before.endsWith('\n')
          ? ' '
          : ''
      const sepAfter =
        after.length > 0 && !after.startsWith(' ') && !after.startsWith('\n')
          ? ' '
          : ''
      nextValue = before + sepBefore + placeholder + sepAfter + after
      nextCaret = (before + sepBefore + placeholder + sepAfter).length
      return nextValue
    })
    requestAnimationFrame(() => {
      const t = textareaRef.current
      if (t) {
        t.focus()
        try {
          t.setSelectionRange(nextCaret, nextCaret)
        } catch {
          /* setSelectionRange can throw if the value isn't applied yet — harmless */
        }
      }
    })
    onSelectionConsumed?.()
  }, [pendingSelection, onSelectionConsumed])

  // Expand `[코멘트 #N +M줄]` tokens to fenced code blocks. Tokens whose id
  // is no longer in the registry (user deleted/edited the placeholder) are
  // dropped silently — matches Claude Code's behavior where stale paste
  // placeholders simply disappear instead of erroring out.
  const expandSelections = (text: string): string => {
    return text.replace(/\[코멘트 #(\d+) \+\d+줄\]/g, (_, n) => {
      const sel = selectionsRef.current.get(Number(n))
      if (!sel) return ''
      const header = sel.source ? `// ${sel.source}\n` : ''
      return `\n\n\`\`\`\n${header}${sel.text}\n\`\`\`\n`
    })
  }

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
    // Selection placeholders expand into fenced code blocks here, mirroring
    // how Claude Code substitutes pasted-text tokens at send time.
    const expanded = expandSelections(value)
    const trimmed = expanded.trimEnd()
    if (!trimmed && pendingImages.length === 0) return
    const images = pendingImages.map((p) => ({
      media_type: p.mediaType,
      data: p.data,
    }))
    setError(null)
    try {
      await sendUserMessage(trimmed, images.length > 0 ? images : undefined)
      setValue('')
      clearImages()
      setShowSlash(false)
      setMention(null)
      setHistoryIdx(null)
      selectionsRef.current.clear()
      selectionCounterRef.current = 0
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
        escClear.reset()
        return
      }
      // While the agent is busy, ESC always interrupts first (CLI parity:
      // PromptInput.tsx treats key.escape during loading as the cancel
      // shortcut). The double-press clear is only available when idle.
      if (busy && onInterrupt) {
        e.preventDefault()
        onInterrupt()
        escClear.reset()
        return
      }
      // Double-press ESC to clear (CLI's useTextInput handleEscape via
      // useDoublePress): first press arms + shows hint, second press
      // within the window clears the input and saves it to history.
      if (value.length > 0) {
        e.preventDefault()
        if (escClear.press()) {
          setValue('')
          setHistoryIdx(null)
          selectionsRef.current.clear()
          selectionCounterRef.current = 0
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
    escClear.reset()
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
      {escClear.hintVisible && !busy && (
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
