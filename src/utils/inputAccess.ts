/**
 * tool_use input은 백엔드가 `unknown`으로 보내기 때문에 화면 단에서는
 * 항상 type-narrowing을 거쳐야 한다. 두 헬퍼가 "있으면 가져오고 없으면
 * 안전한 기본값"을 만들어주므로, optional chaining + typeof 가드를 매번
 * 반복하지 않아도 된다.
 */

export function pickString(input: unknown, key: string): string {
  if (!input || typeof input !== 'object') return ''
  const v = (input as Record<string, unknown>)[key]
  return typeof v === 'string' ? v : ''
}

export function pickArray(input: unknown, key: string): unknown[] {
  if (!input || typeof input !== 'object') return []
  const v = (input as Record<string, unknown>)[key]
  return Array.isArray(v) ? v : []
}
