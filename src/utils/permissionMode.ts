import type { Mode } from '../types'

/**
 * UI ↔ Claude CLI permission-mode encoding.
 *
 * The UI exposes three modes (`default | plan | auto-accept`) and renders
 * each with its own label/chip. Claude's stream-json protocol uses
 * different strings: `default`, `plan`, and `acceptEdits` — plus the
 * historical alias `auto`. Keep both directions next to each other so
 * the mapping stays a single source of truth.
 */

/** UI → CLI string sent over `set_permission_mode`. */
export function modeToClaude(m: Mode): string {
  switch (m) {
    case 'default':
      return 'default'
    case 'plan':
      return 'plan'
    case 'auto-accept':
      return 'acceptEdits'
  }
}

/** CLI string from `session:init` → UI mode. Unknown strings → null. */
export function modeFromClaude(s: string | undefined | null): Mode | null {
  if (!s) return null
  switch (s) {
    case 'default':
      return 'default'
    case 'plan':
      return 'plan'
    case 'auto':
    case 'acceptEdits':
      return 'auto-accept'
    default:
      return null
  }
}

/**
 * Parse the argument to `/permissions <arg>` into a Mode. Accepts both
 * the canonical Claude string (`acceptEdits`) and friendly aliases the
 * user is likely to type (`accept-edits`, `accept`, `auto`, etc.).
 */
export function parsePermissionsArg(s: string): Mode | null {
  const a = s.toLowerCase()
  if (a === 'plan' || a === 'plan-mode') return 'plan'
  if (a === 'default' || a === 'ask') return 'default'
  if (
    a === 'acceptedits' ||
    a === 'accept-edits' ||
    a === 'accept' ||
    a === 'auto' ||
    a === 'auto-accept'
  )
    return 'auto-accept'
  return null
}
