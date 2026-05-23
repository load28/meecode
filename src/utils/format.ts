/**
 * Lightweight text/time formatting helpers shared across the app shell.
 * Kept dependency-free so unit tests don't need a renderer.
 */

const MS_PER_MINUTE = 60_000
const MINUTES_PER_HOUR = 60
const HOURS_PER_DAY = 24
const DAYS_PER_MONTH = 30

/** Korean relative-time label ("방금" / "N분 전" / ...). 0 → empty string. */
export function relativeTimeKr(ms: number): string {
  if (!ms) return ''
  const minutes = Math.floor((Date.now() - ms) / MS_PER_MINUTE)
  if (minutes < 1) return '방금'
  if (minutes < MINUTES_PER_HOUR) return `${minutes}분 전`
  const hours = Math.floor(minutes / MINUTES_PER_HOUR)
  if (hours < HOURS_PER_DAY) return `${hours}시간 전`
  const days = Math.floor(hours / HOURS_PER_DAY)
  if (days < DAYS_PER_MONTH) return `${days}일 전`
  const months = Math.floor(days / DAYS_PER_MONTH)
  return `${months}달 전`
}

/** Truncate to `max` characters, appending an ellipsis when shortened. */
export function truncateWithEllipsis(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max)}…`
}
