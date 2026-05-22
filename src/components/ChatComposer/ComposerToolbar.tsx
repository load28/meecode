import type { Mode } from '../../types'

const MODE_LABEL: Record<Mode, string> = {
  default: '⏎ 기본',
  plan: '📋 Plan',
  'auto-accept': '⚡ Auto',
}

function modelDisplayName(model: string | null | undefined): string {
  if (!model) return '기본'
  if (model.includes('opus')) return 'Opus 4.7'
  if (model.includes('sonnet')) return 'Sonnet 4.6'
  if (model.includes('haiku')) return 'Haiku 4.5'
  return model
}

interface Props {
  mode: Mode
  model: string | null | undefined
  busy: boolean
  disabled: boolean
  hasContent: boolean
  sendDisabled: boolean
  fileInputRef: React.RefObject<HTMLInputElement>
  onFileInputChange: (e: React.ChangeEvent<HTMLInputElement>) => void
  onOpenFilePicker: () => void
  onCycleMode: () => void
  onSendClick: () => void
}

/**
 * Bottom toolbar of the composer card: hidden file input + image-attach
 * button, mode chip (cycles on click), read-only model chip, and the
 * send / interrupt button on the right. All state comes in via props so
 * this stays a pure render.
 */
export function ComposerToolbar({
  mode,
  model,
  busy,
  disabled,
  hasContent,
  sendDisabled,
  fileInputRef,
  onFileInputChange,
  onOpenFilePicker,
  onCycleMode,
  onSendClick,
}: Props) {
  return (
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
        onClick={onOpenFilePicker}
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
        onClick={onCycleMode}
        title="모드 전환 (Shift+Tab)"
      >
        <span>{MODE_LABEL[mode]}</span>
        <span className="chat-composer__chip-shortcut">⇧⇥</span>
      </button>
      <span
        className="chat-composer__chip chat-composer__chip-model"
        title="현재 모델"
      >
        {modelDisplayName(model)}
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
  )
}
