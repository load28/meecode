import { useRef, useState } from 'react'
import type { Mode, SlashCommand } from '../../types'
import { useImageAttachments } from '../../hooks/useImageAttachments'
import { useEscapeDoublePress } from '../../hooks/useEscapeDoublePress'
import { useTextHistory } from '../../hooks/useTextHistory'
import { useSelectionPlaceholders } from '../../hooks/useSelectionPlaceholders'
import { useSlashMenu } from '../../hooks/useSlashMenu'
import { useMentionMenu } from '../../hooks/useMentionMenu'
import { useTextareaAutoGrow } from '../../hooks/useTextareaAutoGrow'
import { useGlobalEscapeInterrupt } from '../../hooks/useGlobalEscapeInterrupt'
import { AttachmentsStrip } from './AttachmentsStrip'
import { ComposerToolbar } from './ComposerToolbar'
import { SlashMenu } from './SlashMenu'
import { MentionMenu } from './MentionMenu'
import { ClaudeWarning } from './ClaudeWarning'
import './ChatComposer.css'

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
  const history = useTextHistory(recentUserTexts)
  const escClear = useEscapeDoublePress()
  const textareaRef = useRef<HTMLTextAreaElement | null>(null)
  const isComposingRef = useRef(false)
  // Registered selections by their inline number (1-based). The textarea
  // value carries `[코멘트 #N +M줄]` tokens; on submit each token expands
  // back into a fenced code block looked up from this map.
  const selections = useSelectionPlaceholders({
    pendingSelection,
    onSelectionConsumed,
    textareaRef,
    value,
    setValue,
  })

  const slashMenu = useSlashMenu({
    value,
    setValue,
    serverCommands: slashCommands,
  })
  const mentionMenu = useMentionMenu({
    value,
    setValue,
    textareaRef,
    projectPath,
  })

  useTextareaAutoGrow(textareaRef, value)

  useGlobalEscapeInterrupt({
    active: !!busy,
    onInterrupt,
    isComposingRef,
    excludeTargetRef: textareaRef,
  })

  const submit = async () => {
    // CLI parity: trim trailing whitespace before submit. Empty input with
    // no attachments is a no-op (matches `onSubmit` in PromptInput.tsx).
    // Selection placeholders expand into fenced code blocks here, mirroring
    // how Claude Code substitutes pasted-text tokens at send time.
    const expanded = selections.expand(value)
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
      slashMenu.setShow(false)
      mentionMenu.close()
      history.reset()
      selections.clear()
    } catch (e) {
      setError(String(e))
    }
  }


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
    if (slashMenu.show && slashMenu.items.length > 0 && !mentionMenu.state) {
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        slashMenu.setSelectedIndex((i) =>
          Math.min(i + 1, slashMenu.items.length - 1),
        )
        return
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault()
        slashMenu.setSelectedIndex((i) => Math.max(i - 1, 0))
        return
      }
      if ((e.key === 'Enter' && !e.shiftKey) || e.key === 'Tab') {
        e.preventDefault()
        const pick =
          slashMenu.items[
            Math.min(slashMenu.selectedIndex, slashMenu.items.length - 1)
          ]
        if (pick) slashMenu.select(pick.name)
        return
      }
      if (e.key === 'Escape') {
        e.preventDefault()
        slashMenu.setShow(false)
        return
      }
    }
    if (mentionMenu.state && mentionMenu.results.length > 0) {
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        mentionMenu.setSelectedIndex((i) =>
          Math.min(i + 1, mentionMenu.results.length - 1),
        )
        return
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault()
        mentionMenu.setSelectedIndex((i) => Math.max(i - 1, 0))
        return
      }
      if ((e.key === 'Enter' && !e.shiftKey) || e.key === 'Tab') {
        e.preventDefault()
        const pick =
          mentionMenu.results[
            Math.min(mentionMenu.selectedIndex, mentionMenu.results.length - 1)
          ]
        if (pick) mentionMenu.select(pick)
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
    if (history.tryNavigate(e, textareaRef.current, value, setValue)) {
      return
    }
    if (e.key === 'Escape') {
      if (mentionMenu.state) {
        e.preventDefault()
        mentionMenu.close()
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
          history.reset()
          selections.clear()
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

  const onChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const v = e.target.value
    const caret = e.target.selectionStart ?? v.length
    setValue(v)
    slashMenu.setShow(v.startsWith('/'))
    slashMenu.setSelectedIndex(0)
    mentionMenu.detect(v, caret)
    history.reset()
    // Any further typing disarms the double-ESC clear (CLI parity).
    escClear.reset()
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
      {slashMenu.show && slashMenu.items.length > 0 && !mentionMenu.state && (
        <SlashMenu
          ref={slashMenu.listRef}
          items={slashMenu.items}
          selectedIndex={slashMenu.selectedIndex}
          onHover={slashMenu.setSelectedIndex}
          onSelect={slashMenu.select}
        />
      )}
      {mentionMenu.state && mentionMenu.results.length > 0 && (
        <MentionMenu
          ref={mentionMenu.listRef}
          results={mentionMenu.results}
          selectedIndex={mentionMenu.selectedIndex}
          onHover={mentionMenu.setSelectedIndex}
          onSelect={mentionMenu.select}
        />
      )}
      <div
        className={
          'chat-composer__card' + (disabled && !busy ? ' is-disabled' : '')
        }
      >
        <AttachmentsStrip images={pendingImages} onRemove={removeImage} />
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
        <ComposerToolbar
          mode={mode}
          model={model}
          busy={!!busy}
          disabled={disabled}
          hasContent={hasContent}
          sendDisabled={sendDisabled}
          fileInputRef={fileInputRef}
          onFileInputChange={onFileInputChange}
          onOpenFilePicker={openFilePicker}
          onCycleMode={cycleMode}
          onSendClick={onSendClick}
        />
      </div>
      {!claudeReady && <ClaudeWarning onOpenSettings={onOpenSettings} />}
    </div>
  )
}
