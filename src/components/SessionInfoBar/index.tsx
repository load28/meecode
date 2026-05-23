import { useState } from 'react'
import type { AgentInfo, McpServerInfo } from '../../hooks/useClaudeSession'
import { SessionInfoPanel } from './SessionInfoPanel'
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
        <SessionInfoPanel
          sessionId={sessionId}
          cwd={cwd}
          mcpServers={mcpServers}
          agents={agents}
          tools={tools}
        />
      )}
    </div>
  )
}
