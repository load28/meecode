/**
 * Client-side slash command dispatch.
 *
 * Background — why some commands need client handling
 * --------------------------------------------------
 * `claude --input-format stream-json` will execute *most* slash commands
 * when they arrive inside a user-text message (verified: `/init`,
 * `/compact`, `/context`, `/cost`, `/usage`, `/review`, `/security-review`,
 * `/clear`, plugin/skill commands). The CLI's input loop reads each user
 * message, sees the text starts with "/", and dispatches via its internal
 * command registry — the same path the TUI uses.
 *
 * What the CLI refuses in stream-json mode are the "interactive-only"
 * commands. They live in the same registry but their `load()` produces
 * "X isn't available in this environment.": `/help`, `/agents`, `/mcp`,
 * `/status`, `/login`, `/logout`, `/doctor`, `/exit`, `/todos`. Forwarding
 * those wastes a round-trip and shows the user a useless error.
 *
 * MeeCode already keeps the data those commands would print (model, mode,
 * usage, session id, mcp servers, agents, tools) in the session store —
 * driven by `session:init` and `session:turn_end`. So we synthesize the
 * response locally instead, the same way the VS Code extension renders
 * its own command panel without going through the CLI.
 */
import { invoke } from '@tauri-apps/api/core'
import type { QaPair } from '../types'
import {
  getTabSnapshot,
  setTab,
  type TabSession,
} from '../state/sessionStore'
import { modeToClaude, parsePermissionsArg } from '../utils/permissionMode'
import { logBackendError } from '../utils/log'
import { makeLocalId } from '../utils/localId'

// Re-exported so existing importers (useClaudeSession, tests) keep working
// without having to update their paths.
export { modeToClaude, parsePermissionsArg }

export interface ParsedSlash {
  cmd: string
  args: string
}

export function parseSlash(text: string): ParsedSlash | null {
  if (!text) return null
  const firstLine = text.split(/\r?\n/, 1)[0].trim()
  if (!firstLine.startsWith('/')) return null
  const m = firstLine.match(/^(\/[A-Za-z][A-Za-z0-9:_-]*)(?:\s+([\s\S]*))?$/)
  if (!m) return null
  return { cmd: m[1].toLowerCase(), args: (m[2] ?? '').trim() }
}

/**
 * Slash commands that meecode handles entirely client-side. Each one
 * either (a) mutates local state via `setTab`, (b) issues a Tauri
 * control_request (`/model`, `/permissions`), or (c) synthesizes a
 * fake assistant response so the user sees a useful answer without the
 * CLI's "isn't available in this environment" placeholder.
 *
 * Order here drives the order in `/help` output.
 */
export const CLIENT_SLASH_COMMANDS: ReadonlyArray<{
  name: string
  description: string
}> = [
  { name: '/clear', description: '대화 내역 비우기' },
  { name: '/exit', description: '대화 내역 비우기 (alias of /clear)' },
  { name: '/quit', description: '대화 내역 비우기 (alias of /clear)' },
  { name: '/model', description: '모델 변경 (예: /model claude-sonnet-4-6)' },
  {
    name: '/permissions',
    description: '권한 모드 변경 (default | plan | acceptEdits)',
  },
  { name: '/help', description: '사용 가능한 슬래시 명령 보기' },
  { name: '/agents', description: '에이전트 목록 보기' },
  { name: '/mcp', description: 'MCP 서버 상태 보기' },
  { name: '/status', description: '세션 상태 보기 (model, mode, cwd 등)' },
  { name: '/cost', description: '사용량 및 비용 통계' },
  { name: '/usage', description: '사용량 및 비용 통계 (alias of /cost)' },
  { name: '/tools', description: '활성 도구 목록 보기' },
  { name: '/login', description: '로그인 안내 (터미널에서 실행)' },
  { name: '/logout', description: '로그아웃 안내 (터미널에서 실행)' },
  { name: '/doctor', description: '진단 안내 (터미널에서 실행)' },
  { name: '/todos', description: 'TODO 목록 (TUI 전용 — 사용 불가 안내)' },
]

const TERMINAL_ONLY_CMDS = ['/login', '/logout', '/doctor'] as const

/**
 * Descriptions for well-known CLI-dispatched commands. The CLI's
 * `session:init` payload only carries names (verified against the
 * fixture and live captures); descriptions live in the CLI's internal
 * command registry and aren't serialized. We hard-code the ones a
 * meecode user is likely to see so the palette is more than a list of
 * bare names.
 *
 * Plugin/skill commands (e.g. `superpowers:execute-plan`,
 * `simplify`, `claude-api`) come and go with the user's installed
 * plugins — we don't try to enumerate them here; the palette just
 * shows the bare name from `session:init` and the user can read the
 * skill's own README. The colon namespace makes them visually
 * distinct from built-ins.
 */
export const SERVER_SLASH_DESCRIPTIONS: Record<string, string> = {
  '/init': '프로젝트 초기화 (CLAUDE.md 생성)',
  '/compact': '대화 압축',
  '/context': '컨텍스트 사용량 보기',
  '/cost': '사용량/비용 (CLI 내장)',
  '/usage': '사용량/비용 (CLI 내장)',
  '/review': '코드 리뷰',
  '/security-review': '보안 리뷰',
  '/insights': '세션 인사이트',
  '/goal': '목표 설정/조회',
  '/team-onboarding': '팀 온보딩',
  '/heapdump': '힙 덤프 (디버그용)',
  '/simplify': '변경 사항 단순화 검토',
  '/claude-api': 'Claude API 도움말',
  '/debug': '디버그 모드',
  '/batch': '배치 모드',
  '/loop': '루프 실행',
  '/fewer-permission-prompts': '권한 프롬프트 줄이기',
  '/update-config': '설정 업데이트',
  '/session-start-hook': '세션 시작 훅',
}

/**
 * Annotate a server-advertised slash command with our hard-coded
 * description when the server didn't send one. Returns the command
 * as-is if a description was already provided or no override is known.
 */
export function decorateServerSlash(c: {
  name: string
  description?: string
}): { name: string; description?: string } {
  if (c.description) return c
  const key = c.name.startsWith('/') ? c.name : '/' + c.name
  const desc = SERVER_SLASH_DESCRIPTIONS[key]
  return desc ? { ...c, description: desc } : c
}

function emitSyntheticPair(
  tabId: string,
  userText: string,
  assistantText: string,
): void {
  const id = makeLocalId('local-slash')
  setTab(tabId, (s) => ({
    ...s,
    pairs: [
      ...s.pairs,
      {
        id,
        user_text: userText,
        segments: [{ kind: 'text', text: assistantText }],
        timestamp: new Date().toISOString(),
      } satisfies QaPair,
    ],
    // Important: don't set currentId. Any further `session:message` deltas
    // from the still-live CLI session must not be attached to this purely
    // local pair — they belong to whatever real turn comes next.
    currentId: null,
  }))
}

function buildHelpText(snapshot: TabSession): string {
  const lines: string[] = []
  lines.push('## 슬래시 명령 도움말')
  lines.push('')
  lines.push('### 클라이언트(MeeCode)에서 바로 처리하는 명령')
  for (const c of CLIENT_SLASH_COMMANDS) {
    lines.push(`- \`${c.name}\` — ${c.description}`)
  }
  if (snapshot.slashCommands.length > 0) {
    lines.push('')
    lines.push('### Claude CLI가 처리하는 명령 (현재 세션 기준)')
    const seen = new Set(CLIENT_SLASH_COMMANDS.map((c) => c.name))
    for (const c of snapshot.slashCommands) {
      const key = c.name.startsWith('/') ? c.name : '/' + c.name
      if (seen.has(key)) continue
      seen.add(key)
      lines.push(
        c.description ? `- \`${key}\` — ${c.description}` : `- \`${key}\``,
      )
    }
  }
  return lines.join('\n')
}

function buildAgentsText(snapshot: TabSession): string {
  if (snapshot.agents.length === 0) {
    return '_등록된 에이전트가 없습니다._'
  }
  const lines: string[] = ['## 에이전트 목록', '']
  for (const a of snapshot.agents) {
    lines.push(
      a.description ? `- **${a.name}** — ${a.description}` : `- **${a.name}**`,
    )
  }
  return lines.join('\n')
}

function buildMcpText(snapshot: TabSession): string {
  if (snapshot.mcpServers.length === 0) {
    return '_MCP 서버가 연결되어 있지 않습니다._'
  }
  const lines: string[] = ['## MCP 서버', '']
  for (const s of snapshot.mcpServers) {
    lines.push(`- **${s.name}** — ${s.status ?? 'unknown'}`)
  }
  return lines.join('\n')
}

function buildToolsText(snapshot: TabSession): string {
  if (snapshot.tools.length === 0) {
    return '_활성 도구 정보가 아직 수신되지 않았습니다._'
  }
  const lines: string[] = [`## 활성 도구 (${snapshot.tools.length})`, '']
  // Group MCP tools by server prefix so the list isn't a wall of dashes.
  const builtin: string[] = []
  const mcp = new Map<string, string[]>()
  for (const t of snapshot.tools) {
    if (t.startsWith('mcp__')) {
      const parts = t.split('__')
      const server = parts[1] ?? 'mcp'
      const tool = parts.slice(2).join('__')
      const arr = mcp.get(server) ?? []
      arr.push(tool)
      mcp.set(server, arr)
    } else {
      builtin.push(t)
    }
  }
  if (builtin.length > 0) {
    lines.push('### 내장')
    lines.push(builtin.map((t) => `\`${t}\``).join(', '))
    lines.push('')
  }
  for (const [server, toolList] of mcp) {
    lines.push(`### MCP · ${server}`)
    lines.push(toolList.map((t) => `\`${t}\``).join(', '))
    lines.push('')
  }
  return lines.join('\n').trimEnd()
}

function buildStatusText(snapshot: TabSession): string {
  const lines: string[] = ['## 세션 상태', '']
  lines.push(`- Model: \`${snapshot.model ?? '(default)'}\``)
  lines.push(`- Mode: \`${snapshot.mode}\``)
  lines.push(`- Session ID: \`${snapshot.sessionId ?? '(pending)'}\``)
  lines.push(`- CWD: \`${snapshot.cwd ?? '(unknown)'}\``)
  lines.push(`- MCP 서버: ${snapshot.mcpServers.length}개`)
  lines.push(`- 에이전트: ${snapshot.agents.length}개`)
  lines.push(`- 도구: ${snapshot.tools.length}개`)
  return lines.join('\n')
}

function buildUsageText(snapshot: TabSession): string {
  const u = snapshot.usage
  if (u.turnCount === 0) {
    return '_아직 사용량 통계가 없습니다. 첫 턴이 완료되면 표시됩니다._'
  }
  const lines: string[] = ['## 사용량 / 비용', '']
  lines.push(`- 누적 비용: **$${u.totalCostUsd.toFixed(4)}**`)
  lines.push(`- 누적 소요 시간: **${(u.totalDurationMs / 1000).toFixed(1)}s**`)
  lines.push(`- 턴 수: ${u.turnCount}`)
  lines.push(`- 입력 토큰: ${u.inputTokens.toLocaleString()}`)
  lines.push(`- 출력 토큰: ${u.outputTokens.toLocaleString()}`)
  if (u.cacheReadTokens || u.cacheCreationTokens) {
    lines.push(
      `- 캐시: read ${u.cacheReadTokens.toLocaleString()} / create ${u.cacheCreationTokens.toLocaleString()}`,
    )
  }
  return lines.join('\n')
}

function buildTerminalOnlyText(cmd: string): string {
  const bare = cmd.replace(/^\//, '')
  return [
    `\`${cmd}\` 명령은 Claude Code 터미널 TUI 전용입니다.`,
    '',
    `터미널에서 직접 실행하세요:`,
    '',
    '```bash',
    `claude ${bare}`,
    '```',
  ].join('\n')
}

export interface DispatchDeps {
  tabId: string
}

interface SlashContext {
  tabId: string
  /** Snapshot taken once at dispatch entry; handlers should not re-read. */
  snapshot: TabSession
  /** Raw user text (placeholder + args); fed back as the `user_text` of any synthetic pair. */
  text: string
  /** Parsed command + args (cmd is already lower-cased). */
  parsed: ParsedSlash
}

type SlashHandler = (ctx: SlashContext) => Promise<void> | void

const handleClear: SlashHandler = async ({ tabId }) => {
  setTab(tabId, (s) => ({
    ...s,
    pairs: [],
    currentId: null,
    queue: [],
    turnError: null,
    turnInProgress: false,
  }))
  // Also reset the CLI's own conversation transcript so the next user
  // message doesn't carry every prior turn as context. `/clear` is a
  // `local` command in the CLI's registry — in stream-json mode it
  // empties the in-memory message history and emits an empty
  // assistant turn (verified). Forward it even on `/exit`/`/quit`
  // since meecode treats those as aliases.
  try {
    await invoke('send_user_message', {
      text: '/clear',
      images: undefined,
      tabId,
    })
  } catch (e) {
    // CLI not running yet (e.g. user fired /clear from an empty
    // folder picker tab) — fine; local state is already reset.
    logBackendError('meecode', '/clear forward to CLI', e)
  }
}

const handleModel: SlashHandler = async ({ tabId, parsed }) => {
  const m = parsed.args || null
  try {
    await invoke('set_model', { model: m, tabId })
    if (m) setTab(tabId, (s) => ({ ...s, model: m }))
  } catch (e) {
    setTab(tabId, (s) => ({
      ...s,
      turnError: `/model 실패: ${String(e)}`,
    }))
  }
}

const handlePermissions: SlashHandler = async ({ tabId, parsed }) => {
  const target = parsePermissionsArg(parsed.args)
  if (!target) {
    setTab(tabId, (s) => ({
      ...s,
      turnError:
        '/permissions <default|plan|acceptEdits> 형식으로 입력하세요',
    }))
    return
  }
  setTab(tabId, (s) => ({ ...s, mode: target }))
  try {
    await invoke('set_permission_mode', {
      mode: modeToClaude(target),
      tabId,
    })
  } catch (e) {
    setTab(tabId, (s) => ({
      ...s,
      turnError: `/permissions 실패: ${String(e)}`,
    }))
  }
}

/** Adapt a snapshot→string builder into a handler that emits a synthetic pair. */
function emitFrom(build: (s: TabSession) => string): SlashHandler {
  return ({ tabId, snapshot, text }) =>
    emitSyntheticPair(tabId, text, build(snapshot))
}

const handleTerminalOnly: SlashHandler = ({ tabId, text, parsed }) =>
  emitSyntheticPair(tabId, text, buildTerminalOnlyText(parsed.cmd))

const handleTodos: SlashHandler = ({ tabId, text }) =>
  emitSyntheticPair(
    tabId,
    text,
    '`/todos`는 Claude Code TUI 전용 명령으로 현재 환경에서 사용할 수 없습니다.',
  )

/**
 * Map of slash command → handler. Aliases share the same handler reference
 * so /exit and /quit behave identically to /clear, /usage to /cost, etc.
 * Lookup is O(1) and adding a new command is a single entry instead of
 * threading a new `if` into a long chain.
 */
const SLASH_HANDLERS: Record<string, SlashHandler> = {
  '/clear': handleClear,
  '/exit': handleClear,
  '/quit': handleClear,
  '/model': handleModel,
  '/permissions': handlePermissions,
  '/help': emitFrom(buildHelpText),
  '/agents': emitFrom(buildAgentsText),
  '/mcp': emitFrom(buildMcpText),
  '/tools': emitFrom(buildToolsText),
  '/status': emitFrom(buildStatusText),
  '/cost': emitFrom(buildUsageText),
  '/usage': emitFrom(buildUsageText),
  '/todos': handleTodos,
  ...Object.fromEntries(
    TERMINAL_ONLY_CMDS.map((cmd) => [cmd, handleTerminalOnly] as const),
  ),
}

/**
 * Dispatch a slash command. Returns `true` if it was handled
 * client-side (so the caller should NOT forward to the CLI), `false`
 * otherwise.
 *
 * Images suppress dispatch: a user attaching screenshots wants the model
 * to see them, not a local synthetic answer — even if their typed text
 * happens to start with "/".
 */
export async function dispatchClientSlash(
  text: string,
  images: Array<{ media_type: string; data: string }> | undefined,
  deps: DispatchDeps,
): Promise<boolean> {
  if (images && images.length > 0) return false
  const parsed = parseSlash(text)
  if (!parsed) return false
  const handler = SLASH_HANDLERS[parsed.cmd]
  if (!handler) {
    // `/init`, `/compact`, `/context`, `/review`, plugin/skill commands, …
    // fall through to the CLI's own dispatcher.
    return false
  }
  const { tabId } = deps
  await handler({ tabId, snapshot: getTabSnapshot(tabId), text, parsed })
  return true
}
