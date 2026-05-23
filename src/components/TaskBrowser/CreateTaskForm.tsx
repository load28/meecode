interface Props {
  name: string
  description: string
  submitting: boolean
  onNameChange: (next: string) => void
  onDescriptionChange: (next: string) => void
  onCancel: () => void
  onSubmit: () => void
}

/**
 * "+ 새 Task" 버튼이 눌렸을 때 펼쳐지는 인라인 폼. 이름 + 선택적 설명을
 * 받고 onSubmit으로 위임. Enter (without Shift)로 빠른 제출이 가능하고,
 * 빈 이름이거나 submitting 중이면 생성 버튼은 비활성.
 */
export function CreateTaskForm({
  name,
  description,
  submitting,
  onNameChange,
  onDescriptionChange,
  onCancel,
  onSubmit,
}: Props) {
  return (
    <div className="task-panel__create">
      <input
        className="task-panel__create-input"
        placeholder="Task 이름"
        value={name}
        onChange={(e) => onNameChange(e.target.value)}
        autoFocus
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault()
            onSubmit()
          }
        }}
      />
      <textarea
        className="task-panel__create-textarea"
        placeholder="설명 (선택)"
        value={description}
        onChange={(e) => onDescriptionChange(e.target.value)}
      />
      <div className="task-panel__create-actions">
        <button
          type="button"
          className="task-panel__btn"
          onClick={onCancel}
        >
          취소
        </button>
        <button
          type="button"
          className="task-panel__btn task-panel__btn--primary"
          onClick={onSubmit}
          disabled={submitting || !name.trim()}
        >
          {submitting ? '생성 중...' : '생성'}
        </button>
      </div>
    </div>
  )
}
