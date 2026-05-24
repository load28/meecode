import type { ParsedTaskContext } from '../../utils/taskContext'
import { MarkdownContent } from '../MessageBubble/MarkdownContent'
import './TaskContextNote.css'

interface Props {
  /** The full context-injection user turn text. */
  text: string
  parsed: ParsedTaskContext
}

/**
 * Collapsed stand-in for an attach-time Task context-injection turn.
 *
 * The raw injection dumps the whole task description + every source into
 * a single user turn, which floods the chat / expand pane. Instead we
 * show a one-line summary (task name + source count) and let the user
 * expand it — same affordance as a loaded Skill body.
 */
export function TaskContextNote({ text, parsed }: Props) {
  return (
    <details className="task-context-note">
      <summary className="task-context-note__summary">
        <span aria-hidden="true">📎</span>
        <span className="task-context-note__label">Task 컨텍스트</span>
        <span className="task-context-note__name">{parsed.taskName}</span>
        {parsed.sourceCount > 0 && (
          <span className="task-context-note__count">
            Source {parsed.sourceCount}개
          </span>
        )}
      </summary>
      <MarkdownContent
        className="message-bubble__content task-context-note__body"
        source={text}
      />
    </details>
  )
}
