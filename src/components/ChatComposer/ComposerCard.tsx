import type { Mode } from '../../types'
import type { PendingImage } from '../../hooks/useImageAttachments'
import { AttachmentsStrip } from './AttachmentsStrip'
import { ComposerToolbar } from './ComposerToolbar'

interface Props {
  value: string
  /** card 전체에 .is-disabled 토글. busy 중에는 disabled여도 카드는 활성. */
  cardDisabled: boolean
  /** textarea 자체의 disabled. claudeReady가 아니거나 도구 승인 대기 등. */
  textareaDisabled: boolean
  /** 보내기 버튼 disabled 여부. busy 때는 항상 false. */
  sendDisabled: boolean
  /** 보내기 버튼이 stop 아이콘으로 바뀌어야 하는 상황(busy). */
  busy: boolean
  disabled: boolean
  hasContent: boolean
  mode: Mode
  model: string | null | undefined
  pendingImages: PendingImage[]
  claudeReady: boolean
  textareaRef: React.MutableRefObject<HTMLTextAreaElement | null>
  fileInputRef: React.RefObject<HTMLInputElement>
  onRemoveImage: (id: string) => void
  onChange: (e: React.ChangeEvent<HTMLTextAreaElement>) => void
  onKeyDown: (e: React.KeyboardEvent<HTMLTextAreaElement>) => void
  onPaste: (e: React.ClipboardEvent<HTMLTextAreaElement>) => void | Promise<void>
  onDrop: (e: React.DragEvent<HTMLTextAreaElement>) => void | Promise<void>
  onCompositionStart: () => void
  onCompositionEnd: () => void
  onFileInputChange: (
    e: React.ChangeEvent<HTMLInputElement>,
  ) => void | Promise<void>
  onOpenFilePicker: () => void
  onCycleMode: () => void
  onSendClick: () => void
}

/**
 * 입력 카드 본체 — 이미지 첨부 행 + textarea + ComposerToolbar의 묶음.
 * 슬래시/멘션 팔레트나 ESC 힌트 등은 카드 밖에 위치하므로 부모가 따로 둔다.
 */
export function ComposerCard({
  value,
  cardDisabled,
  textareaDisabled,
  sendDisabled,
  busy,
  disabled,
  hasContent,
  mode,
  model,
  pendingImages,
  claudeReady,
  textareaRef,
  fileInputRef,
  onRemoveImage,
  onChange,
  onKeyDown,
  onPaste,
  onDrop,
  onCompositionStart,
  onCompositionEnd,
  onFileInputChange,
  onOpenFilePicker,
  onCycleMode,
  onSendClick,
}: Props) {
  return (
    <div className={'chat-composer__card' + (cardDisabled ? ' is-disabled' : '')}>
      <AttachmentsStrip images={pendingImages} onRemove={onRemoveImage} />
      <textarea
        ref={textareaRef}
        className="chat-composer__textarea"
        value={value}
        disabled={textareaDisabled}
        onChange={onChange}
        onKeyDown={onKeyDown}
        onPaste={onPaste}
        onDrop={onDrop}
        onDragOver={(e) => e.preventDefault()}
        onCompositionStart={onCompositionStart}
        onCompositionEnd={onCompositionEnd}
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
        busy={busy}
        disabled={disabled}
        hasContent={hasContent}
        sendDisabled={sendDisabled}
        fileInputRef={fileInputRef}
        onFileInputChange={onFileInputChange}
        onOpenFilePicker={onOpenFilePicker}
        onCycleMode={onCycleMode}
        onSendClick={onSendClick}
      />
    </div>
  )
}
