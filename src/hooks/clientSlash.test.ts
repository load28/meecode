import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn(() => Promise.resolve(() => {})),
}))

const invokeMock = vi.fn().mockResolvedValue(undefined)
vi.mock('@tauri-apps/api/core', () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
}))

import {
  CLIENT_SLASH_COMMANDS,
  SERVER_SLASH_DESCRIPTIONS,
  decorateServerSlash,
  dispatchClientSlash,
  parsePermissionsArg,
  parseSlash,
} from './clientSlash'
import {
  getTabSnapshot,
  setTab,
  initialTabSession,
} from '../state/sessionStore'

const TAB = 'test-tab'

beforeEach(() => {
  setTab(TAB, () => initialTabSession())
  invokeMock.mockClear()
})

describe('parseSlash', () => {
  it('단순 슬래시 명령 파싱', () => {
    expect(parseSlash('/help')).toEqual({ cmd: '/help', args: '' })
    expect(parseSlash('/model claude-sonnet-4-6')).toEqual({
      cmd: '/model',
      args: 'claude-sonnet-4-6',
    })
  })
  it('대소문자 정규화', () => {
    expect(parseSlash('/HELP')).toEqual({ cmd: '/help', args: '' })
  })
  it('네임스페이스/하이픈/언더스코어 허용', () => {
    expect(parseSlash('/superpowers:execute-plan x')).toEqual({
      cmd: '/superpowers:execute-plan',
      args: 'x',
    })
  })
  it('첫 줄만 검사 — 멀티라인은 첫 줄로 판정', () => {
    expect(parseSlash('/init\nextra')).toEqual({ cmd: '/init', args: '' })
  })
  it('슬래시로 시작하지 않으면 null', () => {
    expect(parseSlash('hello /help')).toBeNull()
    expect(parseSlash('')).toBeNull()
  })
})

describe('parsePermissionsArg', () => {
  it.each([
    ['plan', 'plan'],
    ['default', 'default'],
    ['acceptEdits', 'auto-accept'],
    ['accept-edits', 'auto-accept'],
    ['auto', 'auto-accept'],
  ])('%s → %s', (input, expected) => {
    expect(parsePermissionsArg(input)).toBe(expected)
  })
  it('알 수 없는 값은 null', () => {
    expect(parsePermissionsArg('bogus')).toBeNull()
  })
})

describe('dispatchClientSlash — 비-슬래시 텍스트', () => {
  it('일반 텍스트는 false 반환', async () => {
    const r = await dispatchClientSlash('hello world', undefined, { tabId: TAB })
    expect(r).toBe(false)
  })
  it('이미지가 있으면 슬래시도 무시 (false)', async () => {
    const r = await dispatchClientSlash(
      '/help',
      [{ media_type: 'image/png', data: 'AAA' }],
      { tabId: TAB },
    )
    expect(r).toBe(false)
  })
})

describe('dispatchClientSlash — /clear /exit /quit', () => {
  it('/clear는 pairs/queue/turnError 초기화 + CLI에도 forward', async () => {
    setTab(TAB, (s) => ({
      ...s,
      pairs: [
        { id: 'a', user_text: 'q', segments: [], timestamp: 't' },
        { id: 'b', user_text: 'q', segments: [], timestamp: 't' },
      ],
      currentId: 'b',
      queue: [{ id: 'q1', text: 'queued' }],
      turnError: 'oops',
      turnInProgress: true,
    }))
    const r = await dispatchClientSlash('/clear', undefined, { tabId: TAB })
    expect(r).toBe(true)
    const snap = getTabSnapshot(TAB)
    expect(snap.pairs).toEqual([])
    expect(snap.queue).toEqual([])
    expect(snap.turnError).toBeNull()
    expect(snap.turnInProgress).toBe(false)
    expect(invokeMock).toHaveBeenCalledWith('send_user_message', {
      text: '/clear',
      images: undefined,
      tabId: TAB,
    })
  })
  it.each(['/exit', '/quit'])(
    '%s는 alias — 로컬 비우고 CLI에 /clear forward',
    async (cmd) => {
      setTab(TAB, (s) => ({
        ...s,
        pairs: [{ id: 'x', user_text: 'q', segments: [], timestamp: 't' }],
      }))
      const r = await dispatchClientSlash(cmd, undefined, { tabId: TAB })
      expect(r).toBe(true)
      expect(getTabSnapshot(TAB).pairs).toEqual([])
      expect(invokeMock).toHaveBeenCalledWith('send_user_message', {
        text: '/clear',
        images: undefined,
        tabId: TAB,
      })
    },
  )
  it('/clear CLI forward 실패해도 로컬 상태는 비워진 채 유지', async () => {
    setTab(TAB, (s) => ({
      ...s,
      pairs: [{ id: 'a', user_text: 'q', segments: [], timestamp: 't' }],
    }))
    invokeMock.mockRejectedValueOnce(new Error('no session'))
    const r = await dispatchClientSlash('/clear', undefined, { tabId: TAB })
    expect(r).toBe(true)
    expect(getTabSnapshot(TAB).pairs).toEqual([])
  })
})

describe('dispatchClientSlash — /model', () => {
  it('/model <name>은 set_model invoke 후 store 갱신', async () => {
    const r = await dispatchClientSlash(
      '/model claude-sonnet-4-6',
      undefined,
      { tabId: TAB },
    )
    expect(r).toBe(true)
    expect(invokeMock).toHaveBeenCalledWith('set_model', {
      model: 'claude-sonnet-4-6',
      tabId: TAB,
    })
    expect(getTabSnapshot(TAB).model).toBe('claude-sonnet-4-6')
  })
  it('/model 인자 없으면 default로 reset', async () => {
    await dispatchClientSlash('/model', undefined, { tabId: TAB })
    expect(invokeMock).toHaveBeenCalledWith('set_model', {
      model: null,
      tabId: TAB,
    })
  })
  it('/model invoke 실패 시 turnError 설정', async () => {
    invokeMock.mockRejectedValueOnce(new Error('rpc dead'))
    await dispatchClientSlash('/model foo', undefined, { tabId: TAB })
    expect(getTabSnapshot(TAB).turnError).toMatch(/\/model 실패/)
  })
})

describe('dispatchClientSlash — /permissions', () => {
  it('/permissions plan → mode plan + invoke', async () => {
    await dispatchClientSlash('/permissions plan', undefined, { tabId: TAB })
    expect(getTabSnapshot(TAB).mode).toBe('plan')
    expect(invokeMock).toHaveBeenCalledWith('set_permission_mode', {
      mode: 'plan',
      tabId: TAB,
    })
  })
  it('/permissions acceptEdits → auto-accept + invoke', async () => {
    await dispatchClientSlash(
      '/permissions acceptEdits',
      undefined,
      { tabId: TAB },
    )
    expect(getTabSnapshot(TAB).mode).toBe('auto-accept')
    expect(invokeMock).toHaveBeenCalledWith('set_permission_mode', {
      mode: 'acceptEdits',
      tabId: TAB,
    })
  })
  it('/permissions <bogus>는 turnError', async () => {
    await dispatchClientSlash('/permissions bogus', undefined, { tabId: TAB })
    expect(invokeMock).not.toHaveBeenCalled()
    expect(getTabSnapshot(TAB).turnError).toMatch(/permissions/)
  })
})

describe('dispatchClientSlash — 합성 응답 명령', () => {
  it('/help → invoke 없이 도움말 텍스트 페어 추가', async () => {
    setTab(TAB, (s) => ({
      ...s,
      slashCommands: [
        { name: 'init', description: 'init project' },
        { name: 'review' },
      ],
    }))
    const r = await dispatchClientSlash('/help', undefined, { tabId: TAB })
    expect(r).toBe(true)
    expect(invokeMock).not.toHaveBeenCalled()
    const pairs = getTabSnapshot(TAB).pairs
    expect(pairs).toHaveLength(1)
    expect(pairs[0].user_text).toBe('/help')
    expect(pairs[0].segments[0]).toMatchObject({ kind: 'text' })
    const text = (pairs[0].segments[0] as { text: string }).text
    expect(text).toContain('/clear')
    expect(text).toContain('/help')
    expect(text).toContain('/init')
    expect(text).toContain('/review')
  })

  it('/agents — 빈 상태 안내', async () => {
    await dispatchClientSlash('/agents', undefined, { tabId: TAB })
    const pairs = getTabSnapshot(TAB).pairs
    expect(pairs[0].user_text).toBe('/agents')
    expect((pairs[0].segments[0] as { text: string }).text).toMatch(
      /에이전트가 없습니다/,
    )
  })

  it('/agents — 데이터 있을 때 마크다운 리스트', async () => {
    setTab(TAB, (s) => ({
      ...s,
      agents: [
        { name: 'general-purpose', description: 'do anything' },
        { name: 'Explore' },
      ],
    }))
    await dispatchClientSlash('/agents', undefined, { tabId: TAB })
    const text = (getTabSnapshot(TAB).pairs[0].segments[0] as { text: string })
      .text
    expect(text).toContain('general-purpose')
    expect(text).toContain('do anything')
    expect(text).toContain('Explore')
  })

  it('/mcp — 서버 상태 출력', async () => {
    setTab(TAB, (s) => ({
      ...s,
      mcpServers: [
        { name: 'context7', status: 'connected' },
        { name: 'serena', status: 'pending' },
      ],
    }))
    await dispatchClientSlash('/mcp', undefined, { tabId: TAB })
    const text = (getTabSnapshot(TAB).pairs[0].segments[0] as { text: string })
      .text
    expect(text).toContain('context7')
    expect(text).toContain('connected')
    expect(text).toContain('serena')
    expect(text).toContain('pending')
  })

  it('/status — 모델/모드/세션 표시', async () => {
    setTab(TAB, (s) => ({
      ...s,
      model: 'claude-opus-4-7',
      mode: 'plan',
      sessionId: 'sess-1',
      cwd: '/tmp/xyz',
      tools: ['Read', 'Edit'],
    }))
    await dispatchClientSlash('/status', undefined, { tabId: TAB })
    const text = (getTabSnapshot(TAB).pairs[0].segments[0] as { text: string })
      .text
    expect(text).toContain('claude-opus-4-7')
    expect(text).toContain('plan')
    expect(text).toContain('sess-1')
    expect(text).toContain('/tmp/xyz')
  })

  it('/cost — 사용량 없으면 안내', async () => {
    await dispatchClientSlash('/cost', undefined, { tabId: TAB })
    const text = (getTabSnapshot(TAB).pairs[0].segments[0] as { text: string })
      .text
    expect(text).toMatch(/사용량 통계가 없습니다/)
  })

  it('/usage — 사용량 통계 출력', async () => {
    setTab(TAB, (s) => ({
      ...s,
      usage: {
        totalCostUsd: 0.1234,
        totalDurationMs: 5000,
        turnCount: 3,
        inputTokens: 1234,
        outputTokens: 567,
        cacheReadTokens: 100,
        cacheCreationTokens: 50,
      },
    }))
    await dispatchClientSlash('/usage', undefined, { tabId: TAB })
    const text = (getTabSnapshot(TAB).pairs[0].segments[0] as { text: string })
      .text
    expect(text).toContain('$0.1234')
    expect(text).toContain('5.0s')
    expect(text).toContain('1,234')
    expect(text).toContain('567')
  })

  it('/tools — 내장 + MCP 그룹화', async () => {
    setTab(TAB, (s) => ({
      ...s,
      tools: ['Read', 'Edit', 'mcp__context7__query-docs', 'mcp__serena__list'],
    }))
    await dispatchClientSlash('/tools', undefined, { tabId: TAB })
    const text = (getTabSnapshot(TAB).pairs[0].segments[0] as { text: string })
      .text
    expect(text).toContain('내장')
    expect(text).toContain('Read')
    expect(text).toContain('context7')
    expect(text).toContain('query-docs')
    expect(text).toContain('serena')
  })

  it.each(['/login', '/logout', '/doctor'])(
    '%s — 터미널 안내',
    async (cmd) => {
      const r = await dispatchClientSlash(cmd, undefined, { tabId: TAB })
      expect(r).toBe(true)
      expect(invokeMock).not.toHaveBeenCalled()
      const text = (
        getTabSnapshot(TAB).pairs[0].segments[0] as { text: string }
      ).text
      expect(text).toContain('터미널')
      expect(text).toContain(`claude ${cmd.slice(1)}`)
    },
  )

  it('/todos — TUI 전용 안내', async () => {
    await dispatchClientSlash('/todos', undefined, { tabId: TAB })
    expect(invokeMock).not.toHaveBeenCalled()
    const text = (getTabSnapshot(TAB).pairs[0].segments[0] as { text: string })
      .text
    expect(text).toContain('TUI 전용')
  })

  it('합성 페어는 currentId를 차지하지 않아 다음 실제 턴을 가로채지 않는다', async () => {
    setTab(TAB, (s) => ({ ...s, currentId: 'prev' }))
    await dispatchClientSlash('/help', undefined, { tabId: TAB })
    expect(getTabSnapshot(TAB).currentId).toBeNull()
  })
})

describe('dispatchClientSlash — CLI로 전달되는 명령', () => {
  it.each([
    '/init',
    '/compact',
    '/context',
    '/review',
    '/security-review',
    '/superpowers:execute-plan',
  ])('%s는 false 반환 (CLI 전달)', async (cmd) => {
    const r = await dispatchClientSlash(cmd, undefined, { tabId: TAB })
    expect(r).toBe(false)
    expect(invokeMock).not.toHaveBeenCalled()
  })
})

describe('decorateServerSlash', () => {
  it('설명이 이미 있으면 그대로 둔다', () => {
    const c = { name: '/init', description: 'custom desc' }
    expect(decorateServerSlash(c)).toEqual(c)
  })
  it('알려진 CLI 명령에 한글 설명을 채운다', () => {
    expect(decorateServerSlash({ name: '/init' })).toEqual({
      name: '/init',
      description: SERVER_SLASH_DESCRIPTIONS['/init'],
    })
  })
  it('슬래시 없이 들어와도 매핑된다', () => {
    expect(decorateServerSlash({ name: 'compact' })).toMatchObject({
      description: SERVER_SLASH_DESCRIPTIONS['/compact'],
    })
  })
  it('알려지지 않은 플러그인/스킬 명령은 설명 없이 둔다', () => {
    expect(decorateServerSlash({ name: '/superpowers:execute-plan' })).toEqual({
      name: '/superpowers:execute-plan',
    })
  })
})

describe('CLIENT_SLASH_COMMANDS', () => {
  it('필수 명령 포함', () => {
    const names = CLIENT_SLASH_COMMANDS.map((c) => c.name)
    for (const required of [
      '/clear',
      '/exit',
      '/quit',
      '/model',
      '/permissions',
      '/help',
      '/agents',
      '/mcp',
      '/status',
      '/cost',
      '/usage',
      '/tools',
      '/login',
      '/logout',
      '/doctor',
      '/todos',
    ]) {
      expect(names).toContain(required)
    }
  })
  it('모든 명령에 description', () => {
    for (const c of CLIENT_SLASH_COMMANDS) {
      expect(c.description).toBeTruthy()
    }
  })
})
