interface Props {
  name: string
  submitting: boolean
  onNameChange: (next: string) => void
  onSubmit: () => void
}

/**
 * 다이얼로그 하단의 "+ 새 Task 이름" 입력행 + 생성+캡처 버튼 + 단축키 안내.
 * Enter로 빠른 제출이 가능하고, 이름이 빈 문자열이거나 submitting 중이면
 * 버튼은 비활성화된다.
 */
export function CreateTaskRow({
  name,
  submitting,
  onNameChange,
  onSubmit,
}: Props) {
  return (
    <div className="task-picker__create">
      <div className="task-picker__create-row">
        <input
          className="task-picker__create-input"
          placeholder="+ 새 Task 이름"
          value={name}
          onChange={(e) => onNameChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              onSubmit()
            }
          }}
        />
        <button
          type="button"
          className="task-picker__create-btn"
          onClick={onSubmit}
          disabled={submitting || !name.trim()}
        >
          {submitting ? '...' : '생성 + 캡처'}
        </button>
      </div>
      <p className="task-picker__hint">↑↓ 이동 · Enter 캡처 · Esc 닫기</p>
    </div>
  )
}
