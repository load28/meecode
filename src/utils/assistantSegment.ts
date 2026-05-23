import type { AssistantSegment } from '../types'

/**
 * `summary`가 파일 경로인 도구 — QaCard / ExpandPane의 단계 행에서 클릭
 * 가능한 링크로 렌더된다.
 */
export const FILE_PATH_TOOLS = new Set([
  'Read',
  'Edit',
  'Write',
  'MultiEdit',
  'NotebookEdit',
])

/**
 * thinking 세그먼트의 한 줄 라벨.
 *
 *   - partial 중에는 트레일링 "…" 없이 "Thinking" — 옆의 펄싱 dot 트리오가
 *     "in progress" 시그널을 담당한다.
 *   - partial이 끝났고 duration_ms가 있으면 "Thought for Ns" (최소 1초로 클램프).
 */
export function thinkingLabel(
  seg: Extract<AssistantSegment, { kind: 'thinking' }>,
): string {
  if (seg.partial) return 'Thinking'
  if (typeof seg.duration_ms === 'number') {
    return `Thought for ${Math.max(1, Math.round(seg.duration_ms / 1000))}s`
  }
  return 'Thinking'
}
