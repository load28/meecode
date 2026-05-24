import type { Source } from '../types/task'
import { deriveTitle } from './segmentHelpers'

/**
 * Display label for a Source. Prefers the human-authored `title`; for
 * sources captured before titles existed (empty title) it derives a
 * one-line fallback from the content — pulling the question line out of
 * a `qa_block` rather than the bare `## Q` marker.
 */
export function sourceTitle(source: Source): string {
  const explicit = source.title?.trim()
  if (explicit) return explicit
  const qMatch = source.content.match(/##\s*Q\s*\n([^\n]+)/)
  const base = qMatch ? qMatch[1] : source.content
  return deriveTitle(base) || '제목 없는 Source'
}
