import { useState } from 'react'
import type { AgentInfo, McpServerInfo } from '../../hooks/useClaudeSession'
import './SessionInfoBar.css'

interface Props {
  sessionId: string | null
  cwd: string | null
  mcpServers: McpServerInfo[]
  agents: AgentInfo[]
  tools: string[]
}

export function SessionInfoBar({
  sessionId,
  cwd,
  mcpServers,
  agents,
  tools,
}: Props) {
  const [open, setOpen] = useState(false)
  const mcpConnected = mcpServers.filter((m) => m.status === 'connected').length

  return (
    <div className="session-info">
      <button
        type="button"
        className="session-info__toggle"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
      >
        <span className="session-info__chip">{tools.length} tools</span>
        {mcpServers.length > 0 && (
          <span className="session-info__chip">
            {mcpConnected}/{mcpServers.length} MCP
          </span>
        )}
        {agents.length > 0 && (
          <span className="session-info__chip">{agents.length} agents</span>
        )}
        <span className="session-info__caret">{open ? '▾' : '▸'}</span>
      </button>
      {open && (
        <div className="session-info__panel">
          {sessionId && (
            <div className="session-info__row">
              <span className="session-info__label">Session</span>
              <code>{sessionId}</code>
            </div>
          )}
          {cwd && (
            <div className="session-info__row">
              <span className="session-info__label">CWD</span>
              <code>{cwd}</code>
            </div>
          )}
          {mcpServers.length > 0 && (
            <div className="session-info__row">
              <span className="session-info__label">MCP</span>
              <ul className="session-info__list">
                {mcpServers.map((m) => (
                  <li
                    key={m.name}
                    className={'session-info__mcp session-info__mcp--' + (m.status || 'unknown')}
                  >
                    <span className="session-info__dot" />
                    {m.name}
                    {m.status && (
                      <span className="session-info__status">{m.status}</span>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {agents.length > 0 && (
            <div className="session-info__row">
              <span className="session-info__label">Agents</span>
              <ul className="session-info__list">
                {agents.map((a) => (
                  <li key={a.name}>
                    <code>{a.name}</code>
                    {a.description && (
                      <span className="session-info__desc">{a.description}</span>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {tools.length > 0 && (
            <div className="session-info__row">
              <span className="session-info__label">Tools</span>
              <div className="session-info__tools">
                {tools.map((t) => (
                  <code key={t} className="session-info__tool">{t}</code>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
