interface Props {
  error: string | null
  /** true면 "Esc 한 번 더 누르면 입력이 지워집니다" 힌트 노출. */
  showEscClearHint: boolean
}

/**
 * composer 카드 위에 떠있는 두 종류 비차단 알림:
 *   - 빨간 error 배너 (submit 실패 등)
 *   - 더블 ESC clear 직전 힌트
 *
 * 둘 다 데이터가 없으면 자신을 렌더하지 않는다.
 */
export function ComposerNotices({ error, showEscClearHint }: Props) {
  return (
    <>
      {error && (
        <div role="alert" className="chat-composer__error">
          {error}
        </div>
      )}
      {showEscClearHint && (
        <div className="chat-composer__esc-hint" aria-live="polite">
          Esc 한 번 더 누르면 입력이 지워집니다
        </div>
      )}
    </>
  )
}
