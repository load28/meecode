import { forwardRef } from 'react'
import type { SlashCommand } from '../../types'

interface Props {
  items: SlashCommand[]
  selectedIndex: number
  onHover: (index: number) => void
  onSelect: (name: string) => void
}

/** Drop-down palette of available slash commands above the composer. */
export const SlashMenu = forwardRef<HTMLUListElement, Props>(function SlashMenu(
  { items, selectedIndex, onHover, onSelect },
  ref,
) {
  return (
    <ul ref={ref} className="chat-composer__slash" role="listbox">
      {items.map((c, i) => (
        <li key={c.name}>
          <button
            type="button"
            className={
              'chat-composer__slash-item' +
              (i === selectedIndex ? ' is-selected' : '')
            }
            onMouseEnter={() => onHover(i)}
            onClick={() => onSelect(c.name)}
          >
            <span className="chat-composer__slash-name">{c.name}</span>
            {c.description && (
              <span className="chat-composer__slash-desc">{c.description}</span>
            )}
          </button>
        </li>
      ))}
    </ul>
  )
})
