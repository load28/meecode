/**
 * One-line logging helpers shared by IPC-edge call sites.
 *
 * Every backend call in the app wraps `invoke('cmd', ...)` in a try/catch
 * and dumps a `console.warn('[domain] cmd failed', e)` on the way out.
 * Centralizing the format here keeps the prefix style consistent and
 * gives us a single seam for future filtering / telemetry without
 * touching every caller. Output is byte-identical to the prior inline
 * `console.warn` so existing devtool filters keep working.
 */

export function logBackendError(
  domain: string,
  command: string,
  error: unknown,
): void {
  console.warn(`[${domain}] ${command} failed`, error)
}
