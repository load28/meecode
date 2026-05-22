const PREVIEW_MAX_CHARS = 80
const TITLE_TOOLTIP_MAX_CHARS = 240

function previewLine(text: string): string {
  const first = text.split('\n').find((l) => l.trim()) ?? text
  return first.length > PREVIEW_MAX_CHARS
    ? `${first.slice(0, PREVIEW_MAX_CHARS)}…`
    : first
}

interface Props {
  /** draft.content — 미리보기로 한 줄만 노출하고 hover 시 tooltip에 길게. */
  previewText: string | null
  onClose: () => void
}

/**
 * TaskPicker 다이얼로그 상단 — 제목 + 캡처 대상 한 줄 미리보기 + 닫기 버튼.
 */
export function PickerHeader({ previewText, onClose }: Props) {
  return (
    <div className="task-picker__header">
      <h2 className="task-picker__title">Task에 캡처</h2>
      {previewText && (
        <span
          className="task-picker__preview"
          title={previewText.slice(0, TITLE_TOOLTIP_MAX_CHARS)}
        >
          {previewLine(previewText)}
        </span>
      )}
      <button
        type="button"
        className="task-picker__close"
        onClick={onClose}
        aria-label="닫기"
      >
        ×
      </button>
    </div>
  )
}
