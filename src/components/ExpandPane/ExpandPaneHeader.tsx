interface Props {
  /** 활성 pair의 timestamp(ISO). 없으면 빈 제목 표시. */
  timestamp: string | null
  onToggle: () => void
}

function formatTime(iso: string): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return `${String(d.getHours()).padStart(2, '0')}:${String(
    d.getMinutes(),
  ).padStart(2, '0')}`
}

/** ExpandPane 상단 — 접기 버튼 + 활성 pair의 시각(없으면 "펼쳐보기"). */
export function ExpandPaneHeader({ timestamp, onToggle }: Props) {
  return (
    <header className="expand-pane__header">
      <button
        type="button"
        className="expand-pane__toggle"
        aria-label="펼쳐보기 패널 접기"
        onClick={onToggle}
      >
        ▶
      </button>
      <div className="expand-pane__title">
        {timestamp ? (
          <span className="expand-pane__time">{formatTime(timestamp)}</span>
        ) : (
          <span className="expand-pane__title-empty">펼쳐보기</span>
        )}
      </div>
    </header>
  )
}
