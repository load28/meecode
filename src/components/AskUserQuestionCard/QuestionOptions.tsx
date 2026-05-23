import type { AskQuestion } from './index'

interface Props {
  question: AskQuestion
  /** 활성 질문의 인덱스 — radio 그룹 이름을 unique하게 유지하기 위해 사용. */
  activeIndex: number
  picks: Set<string>
  otherText: string
  onToggle: (label: string) => void
  onOtherChange: (text: string) => void
  onOtherEnter: () => void
}

/**
 * 한 질문의 옵션 리스트(+ 마지막 "Other" 행)를 렌더한다. 부모는 picks
 * 집합과 otherText를 들고 있으면서 toggle / setOther 두 콜백만 제공.
 */
export function QuestionOptions({
  question,
  activeIndex,
  picks,
  otherText,
  onToggle,
  onOtherChange,
  onOtherEnter,
}: Props) {
  const handleOtherKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && otherText.trim()) {
      e.preventDefault()
      onOtherEnter()
    }
  }
  const groupName = `q-${activeIndex}`
  const otherChecked = picks.has('Other')
  return (
    <ul className="ask-question-card__options" role="listbox">
      {question.options.map((opt, i) => {
        const checked = picks.has(opt.label)
        const shortcut = i + 1
        return (
          <li
            key={i}
            role="option"
            aria-selected={checked}
            className={
              'ask-question-card__option' + (checked ? ' is-selected' : '')
            }
            onClick={() => onToggle(opt.label)}
          >
            <span
              className="ask-question-card__option-marker"
              aria-hidden="true"
            >
              {checked
                ? question.multiSelect
                  ? '☑'
                  : '●'
                : shortcut <= 9
                ? shortcut
                : '○'}
            </span>
            <div className="ask-question-card__option-body">
              <div className="ask-question-card__option-label">{opt.label}</div>
              {opt.description && (
                <div className="ask-question-card__option-desc">
                  {opt.description}
                </div>
              )}
            </div>
            <input
              type={question.multiSelect ? 'checkbox' : 'radio'}
              name={groupName}
              checked={checked}
              onChange={() => onToggle(opt.label)}
              className="ask-question-card__option-input"
              tabIndex={-1}
            />
          </li>
        )
      })}
      <li
        role="option"
        aria-selected={otherChecked}
        className={
          'ask-question-card__option' + (otherChecked ? ' is-selected' : '')
        }
        onClick={(e) => {
          // 입력란 내부 클릭에서 옵션 토글이 다시 일어나는 일을 막는다.
          if ((e.target as HTMLElement).tagName === 'INPUT') return
          onToggle('Other')
        }}
      >
        <span className="ask-question-card__option-marker" aria-hidden="true">
          {otherChecked
            ? question.multiSelect
              ? '☑'
              : '●'
            : question.options.length + 1 <= 9
            ? question.options.length + 1
            : '○'}
        </span>
        <div className="ask-question-card__option-body">
          <div className="ask-question-card__option-label">Other</div>
          {otherChecked && (
            <input
              type="text"
              className="ask-question-card__other-input"
              placeholder="직접 입력 후 Enter…"
              value={otherText}
              onChange={(e) => onOtherChange(e.target.value)}
              onKeyDown={handleOtherKey}
              onClick={(e) => e.stopPropagation()}
              autoFocus
            />
          )}
        </div>
        <input
          type={question.multiSelect ? 'checkbox' : 'radio'}
          name={groupName}
          checked={otherChecked}
          onChange={() => onToggle('Other')}
          className="ask-question-card__option-input"
          tabIndex={-1}
        />
      </li>
    </ul>
  )
}
