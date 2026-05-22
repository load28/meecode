import { useEffect, useRef, useState } from 'react'

interface Props {
  onSubmit: (message: string) => void
  onCancel: () => void
}

/**
 * "거부 + 의견 전달" 폼. 부모는 deny-with-message 옵션이 선택되면
 * 이 폼으로 전환만 시키고 실제 전송은 onSubmit 콜백으로 받는다.
 * 입력값은 폼 내부 상태로만 들고 있다 — 부모의 submit 직전에 전달.
 *
 * Cmd/Ctrl + Enter로 전송, Esc로 취소.
 */
export function DenyMessageForm({ onSubmit, onCancel }: Props) {
  const [message, setMessage] = useState('')
  const inputRef = useRef<HTMLTextAreaElement | null>(null)

  // 마운트 시 한 번만 textarea에 포커스 — 부모가 deny-with-message를
  // 선택한 직후 진입하므로 사용자는 곧바로 타이핑 가능해야 한다.
  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  const submit = () => {
    const trimmed = message.trim()
    if (!trimmed) return
    onSubmit(trimmed)
  }

  return (
    <div className="tool-approval-card__deny-form" role="form" aria-label="거부 의견">
      <label
        className="tool-approval-card__deny-label"
        htmlFor="deny-message-input"
      >
        Claude에게 전달할 내용 (어떻게 해야 하는지)
      </label>
      <textarea
        id="deny-message-input"
        ref={inputRef}
        className="tool-approval-card__deny-input"
        placeholder="예: 이 파일은 수정하지 말고 별도 파일을 만들어줘"
        value={message}
        onChange={(e) => setMessage(e.target.value)}
        onKeyDown={(e) => {
          // Cmd/Ctrl+Enter는 제출, 일반 Enter는 줄바꿈으로 두어 여러
          // 줄짜리 의견을 쓰기 편하게.
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
            e.preventDefault()
            submit()
          } else if (e.key === 'Escape') {
            e.preventDefault()
            onCancel()
          }
        }}
        rows={3}
      />
      <div className="tool-approval-card__deny-actions">
        <button
          type="button"
          className="tool-approval-card__deny-cancel"
          onClick={onCancel}
        >
          취소
        </button>
        <button
          type="button"
          className="tool-approval-card__deny-submit"
          onClick={submit}
          disabled={!message.trim()}
          title="Cmd/Ctrl + Enter"
        >
          거부 + 전송
        </button>
      </div>
    </div>
  )
}
