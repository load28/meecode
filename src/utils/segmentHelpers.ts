import type { AssistantSegment } from '../types'

const PREVIEW_MAX_CHARS = 500
const PREVIEW_MAX_LINES = 5
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

const TITLE_MAX_CHARS = 60

/**
 * 캡처 다이얼로그에 미리 채워 넣을 한 줄짜리 제목 후보를 만든다.
 * 마크다운 헤더 표시(`#`), 인용(`>`), 목록 마커를 벗겨 첫 의미 있는
 * 줄을 골라 TITLE_MAX_CHARS로 자른다. 비어 있으면 빈 문자열.
 */
export function deriveTitle(src: string): string {
  const firstLine =
    src
      .split('\n')
      .map((l) => l.replace(/^[#>\-*\s]+/, '').trim())
      .find((l) => l.length > 0) ?? ''
  return firstLine.length > TITLE_MAX_CHARS
    ? firstLine.slice(0, TITLE_MAX_CHARS).trimEnd() + '…'
    : firstLine
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
