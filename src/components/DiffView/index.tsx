import { diffLines, diffStats, summarizeDiff } from '../../utils/lineDiff'
import './DiffView.css'

interface Props {
  oldText: string
  newText: string
  /** If true, render side-by-side. Otherwise unified (added/removed stacked). */
  sideBySide?: boolean
  /** Default-open `<details>` toggle wrapping. Provide null to skip the wrapper. */
  collapsibleLabel?: string | null
  defaultOpen?: boolean
}

export function DiffView({
  oldText,
  newText,
  sideBySide = false,
  collapsibleLabel = '변경 보기',
  defaultOpen,
}: Props) {
  const lines = diffLines(oldText, newText)
  const stats = diffStats(lines)
  const summary = summarizeDiff(stats)

  const body = (
    <>
      <div className="diff-view__summary" aria-label="변경 요약">
        <span className="diff-view__stat diff-view__stat--add">+{stats.added}</span>
        <span className="diff-view__stat diff-view__stat--del">−{stats.removed}</span>
        <span className="diff-view__summary-text">{summary}</span>
      </div>
      {sideBySide ? (
        <div className="diff-view__split">
          <SidePane lines={lines} side="old" />
          <SidePane lines={lines} side="new" />
        </div>
      ) : (
        <div className="diff-view__unified">
          {lines.map((l, i) => (
            <div key={i} className={`diff-view__line diff-view__line--${l.op}`}>
              <span className="diff-view__gutter" aria-hidden>
                {l.op === 'insert' ? '+' : l.op === 'delete' ? '−' : ' '}
              </span>
              <span className="diff-view__line-text">{l.text}</span>
            </div>
          ))}
        </div>
      )}
    </>
  )

  if (collapsibleLabel === null) {
    return <div className="diff-view">{body}</div>
  }
  return (
    <details className="diff-view diff-view--collapsible" open={defaultOpen}>
      <summary className="diff-view__toggle">
        <span className="diff-view__toggle-label">{collapsibleLabel}</span>
        <span className="diff-view__toggle-hint">{summary}</span>
      </summary>
      {body}
    </details>
  )
}

function SidePane({
  lines,
  side,
}: {
  lines: ReturnType<typeof diffLines>
  side: 'old' | 'new'
}) {
  return (
    <div className={`diff-view__pane diff-view__pane--${side}`}>
      {lines.map((l, i) => {
        // On the "old" pane, hide insertions; on "new", hide deletions.
        // Render a blank placeholder so line numbers stay aligned.
        const hidden =
          (side === 'old' && l.op === 'insert') || (side === 'new' && l.op === 'delete')
        const lineNo = side === 'old' ? l.oldLineNo : l.newLineNo
        if (hidden) {
          return <div key={i} className="diff-view__line diff-view__line--blank" />
        }
        return (
          <div key={i} className={`diff-view__line diff-view__line--${l.op}`}>
            <span className="diff-view__lineno" aria-hidden>
              {lineNo ?? ''}
            </span>
            <span className="diff-view__line-text">{l.text}</span>
          </div>
        )
      })}
    </div>
  )
}
