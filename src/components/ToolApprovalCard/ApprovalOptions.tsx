import type { ApprovalKey, ApprovalOption } from './options'

interface Props {
  options: ApprovalOption[]
  onSelect: (key: ApprovalKey) => void
}

/**
 * 승인 옵션 목록. 클릭 외에도 부모 onKeyDown이 숫자 키/Enter/Esc를
 * 받아 onSelect를 호출하므로 키보드 동작은 여기서 다시 다루지 않는다.
 */
export function ApprovalOptions({ options, onSelect }: Props) {
  return (
    <>
      <ul className="tool-approval-card__options" role="listbox">
        {options.map((opt, i) => (
          <li
            key={opt.key}
            role="option"
            aria-selected={false}
            className={`tool-approval-card__option tool-approval-card__option--${opt.key}`}
            onClick={() => onSelect(opt.key)}
          >
            <span className="tool-approval-card__option-marker" aria-hidden="true">
              {i + 1}
            </span>
            <div className="tool-approval-card__option-body">
              <div className="tool-approval-card__option-label">{opt.label}</div>
              {opt.description && (
                <div className="tool-approval-card__option-desc">
                  {opt.description}
                </div>
              )}
            </div>
          </li>
        ))}
      </ul>
      <div className="tool-approval-card__hint-row" aria-hidden="true">
        숫자 키로 선택 · Enter는 허용 · Esc는 거부
      </div>
    </>
  )
}
