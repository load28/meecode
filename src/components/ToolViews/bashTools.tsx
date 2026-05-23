import {
  ProgressBadge,
  pickString,
  type ToolViewProps,
} from './_shared'

export function BashView({ segment }: ToolViewProps) {
  const command = pickString(segment.input, 'command')
  const description = pickString(segment.input, 'description')
  const body = command || segment.summary
  return (
    <div className="tool-view tool-view--bash">
      <header className="tool-view__header">
        <span className="tool-view__icon">⌘</span>
        <span className="tool-view__name">Bash</span>
        {description && (
          <span className="tool-view__hint">{description}</span>
        )}
        <ProgressBadge segment={segment} />
      </header>
      {/* Skip the empty pre when streaming hasn't filled `input.command`
          yet — otherwise the card renders a blank black box. */}
      {body && <pre className="tool-view__code">{body}</pre>}
    </div>
  )
}

export function BashOutputView({ segment }: ToolViewProps) {
  const bashId = pickString(segment.input, 'bash_id')
  const filter = pickString(segment.input, 'filter')
  return (
    <div className="tool-view tool-view--bash">
      <header className="tool-view__header">
        <span className="tool-view__icon">⏳</span>
        <span className="tool-view__name">BashOutput</span>
        <span className="tool-view__path">{bashId}</span>
        {filter && <span className="tool-view__hint">filter: {filter}</span>}
      </header>
    </div>
  )
}

export function KillBashView({ segment }: ToolViewProps) {
  const bashId =
    pickString(segment.input, 'shell_id') || pickString(segment.input, 'bash_id')
  return (
    <div className="tool-view tool-view--bash">
      <header className="tool-view__header">
        <span className="tool-view__icon">⛔</span>
        <span className="tool-view__name">KillBash</span>
        <span className="tool-view__path">{bashId}</span>
      </header>
    </div>
  )
}
