import type { QaPair, ToolRequest } from '../../types'
import type { TaskActivity } from '../../state/sessionStore'
import { useSpinnerVerb } from '../../utils/spinnerVerbs'
import './StatusIndicator.css'

/**
 * Bottom-of-pane progress strip — ✴ sparkle + rotating verb (Cogitating /
 * Pondering / Concocting…) + animated dots, matching the VS Code Claude
 * extension's footer indicator.
 *
 * The component is purely presentational: callers compute when to show it
 * and what tool name (if any) overrides the verb rotation. See
 * `computeTurnIndicator` for the shared visibility/override logic shared
 * between ChatStream and ExpandPane.
 */
export function StatusIndicator({
  override,
  taskActivity,
  hookActivity,
  className,
}: {
  override: string | null
  taskActivity: TaskActivity | null
  hookActivity: string | null
  /** Optional modifier class — e.g. `status-indicator--inline` for the
   *  ExpandPane variant that flows with the content instead of pinning
   *  to the bottom of the pane. */
  className?: string
}) {
  const verb = useSpinnerVerb({ override })
  const detail = taskActivity?.description ?? hookActivity ?? null
  return (
    <div
      className={
        className ? `status-indicator ${className}` : 'status-indicator'
      }
      role="status"
      aria-live="polite"
    >
      <span className="status-indicator__spinner" aria-hidden="true" />
      <span className="status-indicator__label">{verb}…</span>
      {detail && <span className="status-indicator__detail">{detail}</span>}
      <span className="status-indicator__dots" aria-hidden="true">
        <span />
        <span />
        <span />
      </span>
    </div>
  )
}

/**
 * Shared rule for whether the indicator should be visible and what tool
 * name (if any) should override the gerund verb rotation. Used by both
 * `ChatStream` and `ExpandPane` so the two surfaces stay in sync —
 * "claude is busy" is a session-level fact, not a per-view one.
 */
export function computeTurnIndicator(
  pairs: QaPair[],
  pendingTool: ToolRequest | null,
  turnInProgress: boolean,
): { show: boolean; override: string | null } {
  const last = pairs[pairs.length - 1]
  const lastSeg = last?.segments[last.segments.length - 1]
  const override: string | null =
    !pendingTool && last
      ? last.segments.length === 0
        ? null
        : lastSeg && lastSeg.kind === 'tool_use'
        ? lastSeg.name
        : null
      : null
  const show = turnInProgress && !pendingTool && last !== undefined
  return { show, override }
}
