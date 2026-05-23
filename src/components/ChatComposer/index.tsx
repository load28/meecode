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
import type { PendingComposerSelection } from '../../hooks/usePendingSelection'
import { ComposerCard } from './ComposerCard'
import { ComposerNotices } from './ComposerNotices'
import { ComposerMenus } from './ComposerMenus'
import { ClaudeWarning } from './ClaudeWarning'
import { useComposerKeyboard } from './useComposerKeyboard'
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
  pendingSelection?: PendingComposerSelection | null
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


  const onKeyDown = useComposerKeyboard({
    value,
    setValue,
    textareaRef,
    ime,
    slashMenu,
    mentionMenu,
    history,
    escClear,
    busy: !!busy,
    cycleMode,
    onInterrupt,
    onClearConversation,
    onConfirmedEscClear: () => {
      setValue('')
      history.reset()
      selections.clear()
    },
    submit,
  })

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
