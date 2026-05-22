/**
 * 짧은 client-side 유일 식별자 생성기. Tauri/백엔드와 무관한 임시 id
 * — 큐 항목, 로컬 합성 pair, 이미지 첨부 등에 쓰인다.
 *
 * 다섯 곳에 흩어져 있던 `${Date.now()}-${Math.random().toString(36)...}`
 * 패턴을 한 함수로 통합. 충돌 가능성은 ms 단위 + 36진수 4글자 조합으로
 * 한 세션 내 사용량에 비해 충분히 낮다.
 */
export function makeLocalId(prefix: string, randomChars: number = 4): string {
  const random = Math.random()
    .toString(36)
    .slice(2, 2 + randomChars)
  return `${prefix}-${Date.now()}-${random}`
}
