interface Props {
  title: string
  onBack: () => void
  onClose?: () => void
}

/** Back / title / optional close bar at the top of the TaskDetail panel. */
export function TaskDetailHeader({ title, onBack, onClose }: Props) {
  return (
    <div className="task-panel__header">
      <button
        type="button"
        className="task-panel__back"
        onClick={onBack}
        aria-label="목록으로"
      >
        ←
      </button>
      <h2 className="task-panel__title">{title}</h2>
      {onClose && (
        <button
          type="button"
          className="task-panel__close"
          onClick={onClose}
          aria-label="패널 닫기"
        >
          ×
        </button>
      )}
    </div>
  )
}
