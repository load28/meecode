interface Props {
  onOpenSettings: (() => void) | undefined
}

/**
 * Claude CLI 경로가 설정되지 않았거나 검증에 실패했을 때 composer 하단에
 * 띄우는 안내 배너. onOpenSettings가 없으면 버튼은 생략한다.
 */
export function ClaudeWarning({ onOpenSettings }: Props) {
  return (
    <div className="chat-composer__claude-warning" role="status">
      <span>Claude CLI 경로가 설정되어 있지 않거나 무효합니다.</span>
      {onOpenSettings && (
        <button
          type="button"
          className="chat-composer__claude-warning-btn"
          onClick={onOpenSettings}
        >
          설정 열기
        </button>
      )}
    </div>
  )
}
