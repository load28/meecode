import { forwardRef } from 'react'

const MAX_VISIBLE_RESULTS = 20

interface Props {
  results: string[]
  selectedIndex: number
  onHover: (index: number) => void
  onSelect: (path: string) => void
}

/** File-search palette shown while typing `@<query>` in the composer. */
export const MentionMenu = forwardRef<HTMLUListElement, Props>(function MentionMenu(
  { results, selectedIndex, onHover, onSelect },
  ref,
) {
  return (
    <ul ref={ref} className="chat-composer__mention" role="listbox">
      {results.slice(0, MAX_VISIBLE_RESULTS).map((p, i) => (
        <li key={p}>
          <button
            type="button"
            className={
              'chat-composer__mention-item' +
              (i === selectedIndex ? ' is-selected' : '')
            }
            onMouseEnter={() => onHover(i)}
            onClick={() => onSelect(p)}
          >
            <span className="chat-composer__mention-path">{p}</span>
          </button>
        </li>
      ))}
    </ul>
  )
})
