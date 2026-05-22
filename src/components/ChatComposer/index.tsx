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
import { useImeComposingGuard } from '../../hooks/useImeComposingGuard'
import { useComposerSubmit } from '../../hooks/useComposerSubmit'
import { ComposerCard } from './ComposerCard'
import { ComposerNotices } from './ComposerNotices'
import { ComposerMenus } from './ComposerMenus'
import { ClaudeWarning } from './ClaudeWarning'
import { tryNewlineInsert } from './newlineInsert'
import { handleEscape } from './escapeHandler'
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
  const ime = useImeComposingGuard()
  const { isComposingRef } = ime
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

  const { error, submit } = useComposerSubmit({
    value,
    setValue,
    expandSelections: selections.expand,
    pendingImages,
    sendUserMessage,
    onAfterSubmit: () => {
      clearImages()
      slashMenu.setShow(false)
      mentionMenu.close()
      history.reset()
      selections.clear()
    },
  })


  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // IME 가드 — 조합 중일 때는 Enter류 키만 막고 ESC는 통과(조합 취소 +
    // interrupt를 위해).
    const composing = ime.isComposingEvent(e)
    if (composing && e.key !== 'Escape') return
    // 멘션이 활성이면 그쪽이 우선 — 원래 slash 분기에 !mentionMenu.state
    // 가드가 있었던 것과 동일한 순서. 멘션이 비활성이고 슬래시가 열려있을
    // 때에만 슬래시 키 처리가 일어난다.
    if (mentionMenu.handleKeyDown(e)) return
    if (slashMenu.handleKeyDown(e)) return
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
    if (
      handleEscape(e, {
        mentionActive: !!mentionMenu.state,
        closeMention: mentionMenu.close,
        busy: !!busy,
        onInterrupt,
        escClear,
        hasInput: value.length > 0,
        onConfirmedClear: () => {
          setValue('')
          history.reset()
          selections.clear()
        },
      })
    ) {
      return
    }
    if (composing) return
    // Enter 줄바꿈 삽입(backslash+Enter / Alt+Enter / Meta+Enter)을 먼저
    // 시도 — 처리된 경우 submit으로 흘러가지 않는다.
    if (tryNewlineInsert(e, textareaRef.current, value, setValue)) return
    if (e.key === 'Enter' && !e.shiftKey && !e.metaKey && !e.altKey) {
      e.preventDefault()
      submit()
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
      <ComposerNotices
        error={error}
        showEscClearHint={escClear.hintVisible && !busy}
      />
      <ComposerMenus slash={slashMenu} mention={mentionMenu} />
      <ComposerCard
        value={value}
        cardDisabled={disabled && !busy}
        textareaDisabled={composerDisabled}
        sendDisabled={sendDisabled}
        busy={!!busy}
        disabled={disabled}
        hasContent={hasContent}
        mode={mode}
        model={model}
        pendingImages={pendingImages}
        claudeReady={claudeReady}
        textareaRef={textareaRef}
        fileInputRef={fileInputRef}
        onRemoveImage={removeImage}
        onChange={onChange}
        onKeyDown={onKeyDown}
        onPaste={onPaste}
        onDrop={onDrop}
        onCompositionStart={ime.onCompositionStart}
        onCompositionEnd={ime.onCompositionEnd}
        onFileInputChange={onFileInputChange}
        onOpenFilePicker={openFilePicker}
        onCycleMode={cycleMode}
        onSendClick={onSendClick}
      />
      {!claudeReady && <ClaudeWarning onOpenSettings={onOpenSettings} />}
    </div>
  )
}
