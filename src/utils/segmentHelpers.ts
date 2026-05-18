import type { AssistantSegment } from '../types'

const PREVIEW_MAX_CHARS = 240
const PREVIEW_MAX_LINES = 3
const ELLIPSIS = '…'

export function totalTextChars(segments: AssistantSegment[]): number {
  let total = 0
  for (const seg of segments) {
    if (seg.kind === 'text' || seg.kind === 'plan') {
      total += [...seg.text].length
    }
  }
  return total
}

export function makePreview(src: string): string {
  const lines = src.split('\n')
  let preview = lines.length > PREVIEW_MAX_LINES
    ? lines.slice(0, PREVIEW_MAX_LINES).join('\n')
    : src
  let truncated = preview !== src

  if (preview.length > PREVIEW_MAX_CHARS) {
    preview = preview.slice(0, PREVIEW_MAX_CHARS)
    truncated = true
  }

  return truncated ? preview + ELLIPSIS : preview
}
