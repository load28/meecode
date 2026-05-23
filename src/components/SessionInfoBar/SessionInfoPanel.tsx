import type { AgentInfo, McpServerInfo } from '../../hooks/useClaudeSession'

interface Props {
  sessionId: string | null
  cwd: string | null
  mcpServers: McpServerInfo[]
  agents: AgentInfo[]
  tools: string[]
}

/**
 * SessionInfoBar의 펼쳐진 본문 — 활성 세션의 메타데이터(session id, cwd,
 * MCP 서버, agent 목록, tools)를 한 행씩 보여준다. 각 섹션은 데이터가
 * 있을 때만 렌더된다.
 */
export function SessionInfoPanel({
  sessionId,
  cwd,
  mcpServers,
  agents,
  tools,
}: Props) {
  return (
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
                className={
                  'session-info__mcp session-info__mcp--' + (m.status || 'unknown')
                }
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
              <code key={t} className="session-info__tool">
                {t}
              </code>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
