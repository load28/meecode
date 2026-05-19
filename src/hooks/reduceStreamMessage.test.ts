import { describe, it, expect } from 'vitest'
import {
  reduceStreamMessage,
  reduceStreamPartial,
  reduceToolProgress,
  makeInitialMessageState,
  type StreamMessageEvent,
} from './reduceStreamMessage'

const user = (uuid: string, content: unknown): StreamMessageEvent => ({
  kind: 'user',
  uuid,
  body: { role: 'user', content },
})

const assistant = (content: unknown): StreamMessageEvent => ({
  kind: 'assistant',
  uuid: null,
  body: { role: 'assistant', content },
})

describe('reduceStreamMessage', () => {
  it('단일 user→assistant 쌍이 한 페어가 된다', () => {
    let s = makeInitialMessageState([])
    s = reduceStreamMessage(s, user('u1', 'hi'))
    s = reduceStreamMessage(s, assistant([{ type: 'text', text: 'hello' }]))
    expect(s.pairs).toHaveLength(1)
    expect(s.pairs[0].id).toBe('u1')
    expect(s.pairs[0].user_text).toBe('hi')
    expect(s.pairs[0].segments).toEqual([{ kind: 'text', text: 'hello' }])
  })

  it('연속 assistant 메시지는 같은 페어에 segments append', () => {
    let s = makeInitialMessageState([])
    s = reduceStreamMessage(s, user('u1', 'q'))
    s = reduceStreamMessage(s, assistant([{ type: 'text', text: 'first' }]))
    s = reduceStreamMessage(s, assistant([{ type: 'text', text: 'second' }]))
    expect(s.pairs).toHaveLength(1)
    expect(s.pairs[0].segments).toEqual([
      { kind: 'text', text: 'first' },
      { kind: 'text', text: 'second' },
    ])
  })

  it('tool_result-only user 메시지는 새 페어를 만들지 않고 in-flight 페어에 tool_result 추가', () => {
    let s = makeInitialMessageState([])
    s = reduceStreamMessage(s, user('u1', 'q'))
    s = reduceStreamMessage(s, assistant([{ type: 'text', text: 'before' }]))
    s = reduceStreamMessage(
      s,
      user('u2', [{ type: 'tool_result', tool_use_id: 'x', content: 'out' }]),
    )
    s = reduceStreamMessage(s, assistant([{ type: 'text', text: 'after' }]))
    expect(s.pairs).toHaveLength(1)
    expect(s.pairs[0].segments).toEqual([
      { kind: 'text', text: 'before' },
      { kind: 'tool_result', tool_use_id: 'x', text: 'out', is_error: false },
      { kind: 'text', text: 'after' },
    ])
  })

  it('두 번째 user는 새 페어를 시작', () => {
    let s = makeInitialMessageState([])
    s = reduceStreamMessage(s, user('u1', 'q1'))
    s = reduceStreamMessage(s, assistant([{ type: 'text', text: 'a1' }]))
    s = reduceStreamMessage(s, user('u2', 'q2'))
    s = reduceStreamMessage(s, assistant([{ type: 'text', text: 'a2' }]))
    expect(s.pairs).toHaveLength(2)
    expect(s.pairs[0].user_text).toBe('q1')
    expect(s.pairs[1].user_text).toBe('q2')
  })

  it('tool_use는 tool_use segment로 들어가고 id를 보존', () => {
    let s = makeInitialMessageState([])
    s = reduceStreamMessage(s, user('u1', 'q'))
    s = reduceStreamMessage(
      s,
      assistant([
        { type: 'tool_use', id: 'tu1', name: 'Bash', input: { command: 'ls -la' } },
      ]),
    )
    expect(s.pairs[0].segments).toEqual([
      {
        kind: 'tool_use',
        id: 'tu1',
        name: 'Bash',
        summary: 'ls -la',
        input: { command: 'ls -la' },
      },
    ])
  })

  it('user.tool_result-only 메시지는 in-flight 페어에 tool_result segment 추가', () => {
    let s = makeInitialMessageState([])
    s = reduceStreamMessage(s, user('u1', 'q'))
    s = reduceStreamMessage(
      s,
      assistant([
        { type: 'tool_use', id: 'tu1', name: 'Read', input: { file_path: '/a' } },
      ]),
    )
    s = reduceStreamMessage(s, {
      kind: 'user',
      uuid: 'u-tr',
      body: {
        role: 'user',
        content: [
          { type: 'tool_result', tool_use_id: 'tu1', content: 'hello world' },
        ],
      },
    })
    expect(s.pairs).toHaveLength(1)
    expect(s.pairs[0].segments).toEqual([
      {
        kind: 'tool_use',
        id: 'tu1',
        name: 'Read',
        summary: '/a',
        input: { file_path: '/a' },
      },
      {
        kind: 'tool_result',
        tool_use_id: 'tu1',
        text: 'hello world',
        is_error: false,
      },
    ])
  })

  it('tool_result.content가 array of text면 줄바꿈으로 합쳐 보존', () => {
    let s = makeInitialMessageState([])
    s = reduceStreamMessage(s, user('u1', 'q'))
    s = reduceStreamMessage(
      s,
      assistant([
        { type: 'tool_use', id: 'tu1', name: 'Bash', input: { command: 'ls' } },
      ]),
    )
    s = reduceStreamMessage(s, {
      kind: 'user',
      uuid: 'u-tr',
      body: {
        role: 'user',
        content: [
          {
            type: 'tool_result',
            tool_use_id: 'tu1',
            content: [
              { type: 'text', text: 'line1' },
              { type: 'text', text: 'line2' },
            ],
            is_error: true,
          },
        ],
      },
    })
    const last = s.pairs[0].segments.at(-1)!
    expect(last).toEqual({
      kind: 'tool_result',
      tool_use_id: 'tu1',
      text: 'line1\nline2',
      is_error: true,
    })
  })

  it('ExitPlanMode는 plan segment로 변환된다', () => {
    let s = makeInitialMessageState([])
    s = reduceStreamMessage(s, user('u1', 'plan plz'))
    s = reduceStreamMessage(
      s,
      assistant([
        { type: 'tool_use', name: 'ExitPlanMode', input: { plan: '# Plan\nstep' } },
      ]),
    )
    expect(s.pairs[0].segments).toEqual([{ kind: 'plan', text: '# Plan\nstep' }])
  })

  it('history pairs로 초기화된 후 assistant가 마지막 페어에 누적', () => {
    const initial = [
      {
        id: 'u-prev',
        user_text: '이전 질문',
        segments: [{ kind: 'text' as const, text: '이전 답' }],
        timestamp: '2026-05-18T00:00:00Z',
      },
    ]
    let s = makeInitialMessageState(initial)
    s = reduceStreamMessage(s, assistant([{ type: 'text', text: 'follow up' }]))
    expect(s.pairs).toHaveLength(1)
    expect(s.pairs[0].segments).toEqual([
      { kind: 'text', text: '이전 답' },
      { kind: 'text', text: 'follow up' },
    ])
  })

  it('thinking은 thinking segment로 들어가고 text보다 앞에 위치', () => {
    let s = makeInitialMessageState([])
    s = reduceStreamMessage(s, user('u1', 'q'))
    s = reduceStreamMessage(
      s,
      assistant([
        { type: 'thinking', thinking: '사용자에게 친근하게 답하자' },
        { type: 'text', text: '안녕하세요' },
      ]),
    )
    expect(s.pairs[0].segments).toEqual([
      { kind: 'thinking', text: '사용자에게 친근하게 답하자' },
      { kind: 'text', text: '안녕하세요' },
    ])
  })

  it('빈 thinking은 무시', () => {
    let s = makeInitialMessageState([])
    s = reduceStreamMessage(s, user('u1', 'q'))
    s = reduceStreamMessage(
      s,
      assistant([
        { type: 'thinking', thinking: '' },
        { type: 'text', text: 'answer' },
      ]),
    )
    expect(s.pairs[0].segments).toEqual([{ kind: 'text', text: 'answer' }])
  })

  it('빈 content는 무시', () => {
    let s = makeInitialMessageState([])
    s = reduceStreamMessage(s, user('u1', 'q'))
    s = reduceStreamMessage(s, assistant([]))
    s = reduceStreamMessage(s, assistant([{ type: 'text', text: 'real' }]))
    expect(s.pairs[0].segments).toEqual([{ kind: 'text', text: 'real' }])
  })

  it('parent_tool_use_id 있는 assistant 메시지는 부모 tool_use children에 라우팅', () => {
    let s = makeInitialMessageState([])
    s = reduceStreamMessage(s, user('u1', 'q'))
    s = reduceStreamMessage(
      s,
      assistant([
        {
          type: 'tool_use',
          id: 'tu-agent',
          name: 'Agent',
          input: { description: 'explore' },
        },
      ]),
    )
    s = reduceStreamMessage(s, {
      kind: 'assistant',
      uuid: 'u-sub',
      parent_tool_use_id: 'tu-agent',
      body: { role: 'assistant', content: [{ type: 'text', text: 'sub thought' }] },
    })
    const top = s.pairs[0].segments[0]
    expect(top.kind).toBe('tool_use')
    if (top.kind !== 'tool_use') throw new Error('typeguard')
    expect(top.children).toEqual([
      { role: 'assistant', segments: [{ kind: 'text', text: 'sub thought' }] },
    ])
  })

  it('parent_tool_use_id user 메시지는 부모의 children에 tool_result 추가', () => {
    let s = makeInitialMessageState([])
    s = reduceStreamMessage(s, user('u1', 'q'))
    s = reduceStreamMessage(
      s,
      assistant([
        { type: 'tool_use', id: 'tu-agent', name: 'Agent', input: {} },
      ]),
    )
    s = reduceStreamMessage(s, {
      kind: 'user',
      uuid: 'u-tr',
      parent_tool_use_id: 'tu-agent',
      body: {
        role: 'user',
        content: [
          { type: 'tool_result', tool_use_id: 'inner-tu', content: 'inner out' },
        ],
      },
    })
    const top = s.pairs[0].segments[0]
    if (top.kind !== 'tool_use') throw new Error('typeguard')
    expect(top.children).toEqual([
      {
        role: 'user',
        segments: [
          {
            kind: 'tool_result',
            tool_use_id: 'inner-tu',
            text: 'inner out',
            is_error: false,
          },
        ],
      },
    ])
  })
})

describe('reduceStreamPartial (--include-partial-messages)', () => {
  const startPair = () => {
    let s = makeInitialMessageState([])
    s = reduceStreamMessage(s, user('u1', 'q'))
    return s
  }

  it('thinking content_block_start + delta + stop이 partial thinking 세그먼트로 누적', () => {
    let s = startPair()
    s = reduceStreamPartial(
      s,
      {
        event: { type: 'content_block_start', content_block: { type: 'thinking', thinking: '' } },
      },
      1_000,
    )
    s = reduceStreamPartial(s, {
      event: { type: 'content_block_delta', delta: { type: 'thinking_delta', thinking: '음 ' } },
    })
    s = reduceStreamPartial(s, {
      event: { type: 'content_block_delta', delta: { type: 'thinking_delta', thinking: '천천히' } },
    })
    expect(s.pairs[0].segments).toEqual([
      { kind: 'thinking', text: '음 천천히', partial: true, duration_ms: 1_000 },
    ])
    s = reduceStreamPartial(
      s,
      { event: { type: 'content_block_stop' } },
      3_500,
    )
    expect(s.pairs[0].segments).toEqual([
      { kind: 'thinking', text: '음 천천히', partial: false, duration_ms: 2_500 },
    ])
  })

  it('text_delta는 partial text 세그먼트에 append', () => {
    let s = startPair()
    s = reduceStreamPartial(s, {
      event: { type: 'content_block_start', content_block: { type: 'text', text: '' } },
    })
    s = reduceStreamPartial(s, {
      event: { type: 'content_block_delta', delta: { type: 'text_delta', text: 'Hel' } },
    })
    s = reduceStreamPartial(s, {
      event: { type: 'content_block_delta', delta: { type: 'text_delta', text: 'lo!' } },
    })
    expect(s.pairs[0].segments).toEqual([
      { kind: 'text', text: 'Hello!', partial: true },
    ])
  })

  it('content_block_stop 없이 full assistant 도착 시 in-flight partial=true는 잘리고 final 추가', () => {
    let s = startPair()
    s = reduceStreamPartial(s, {
      event: { type: 'content_block_start', content_block: { type: 'text', text: '' } },
    })
    s = reduceStreamPartial(s, {
      event: { type: 'content_block_delta', delta: { type: 'text_delta', text: 'partial' } },
    })
    // Aggregated message arrives before content_block_stop (rare/edge case)
    s = reduceStreamMessage(s, assistant([{ type: 'text', text: 'partial complete' }]))
    expect(s.pairs[0].segments).toEqual([
      { kind: 'text', text: 'partial complete' },
    ])
  })

  it('content_block_stop 후 full assistant 도착 시 streamed 세그먼트 유지 + thinking/text 블록은 중복 제거', () => {
    let s = startPair()
    s = reduceStreamPartial(
      s,
      { event: { type: 'content_block_start', content_block: { type: 'thinking', thinking: '' } } },
      1_000,
    )
    s = reduceStreamPartial(s, {
      event: { type: 'content_block_delta', delta: { type: 'thinking_delta', thinking: 'hmm' } },
    })
    s = reduceStreamPartial(s, { event: { type: 'content_block_stop' } }, 2_000)
    // duration_ms = 1000ms, partial: false. Full message arrives with same thinking + tool_use.
    s = reduceStreamMessage(
      s,
      assistant([
        { type: 'thinking', thinking: 'hmm' },
        { type: 'tool_use', id: 'tu-1', name: 'Read', input: { file_path: '/x' } },
      ]),
    )
    // thinking (streamed, partial=false) preserved; only tool_use appended.
    expect(s.pairs[0].segments).toEqual([
      { kind: 'thinking', text: 'hmm', partial: false, duration_ms: 1_000 },
      {
        kind: 'tool_use',
        id: 'tu-1',
        name: 'Read',
        summary: '/x',
        input: { file_path: '/x' },
      },
    ])
  })

  it('--include-partial-messages off (streamed 없음) → assistant content 정상 추가 (legacy 경로)', () => {
    let s = startPair()
    s = reduceStreamMessage(
      s,
      assistant([
        { type: 'thinking', thinking: 'plain' },
        { type: 'text', text: 'plain text' },
      ]),
    )
    expect(s.pairs[0].segments).toEqual([
      { kind: 'thinking', text: 'plain' },
      { kind: 'text', text: 'plain text' },
    ])
  })

  it('parent_tool_use_id가 있는 stream_event는 (서브에이전트 partial은) 일단 noop', () => {
    let s = startPair()
    const before = s
    s = reduceStreamPartial(s, {
      event: { type: 'content_block_delta', delta: { type: 'text_delta', text: 'x' } },
      parent_tool_use_id: 'tu-agent',
    })
    expect(s).toBe(before)
  })
})

describe('reduceToolProgress', () => {
  it('매칭되는 tool_use 세그먼트의 progress에 entry 추가', () => {
    let s = makeInitialMessageState([])
    s = reduceStreamMessage(s, user('u1', 'q'))
    s = reduceStreamMessage(
      s,
      assistant([
        { type: 'tool_use', id: 'tu-1', name: 'Bash', input: { command: 'sleep 5' } },
      ]),
    )
    s = reduceToolProgress(s, {
      tool_use_id: 'tu-1',
      tool_name: 'Bash',
      phase: 'running',
      elapsed_time_seconds: 3,
    })
    const seg = s.pairs[0].segments[0]
    if (seg.kind !== 'tool_use') throw new Error('typeguard')
    expect(seg.progress).toEqual([
      { phase: 'running', elapsed_seconds: 3, last_tool_name: undefined },
    ])
  })

  it('매칭 안 되는 tool_use_id면 변동 없음', () => {
    let s = makeInitialMessageState([])
    s = reduceStreamMessage(s, user('u1', 'q'))
    s = reduceStreamMessage(
      s,
      assistant([
        { type: 'tool_use', id: 'tu-real', name: 'Bash', input: {} },
      ]),
    )
    const before = s
    s = reduceToolProgress(s, { tool_use_id: 'tu-other' })
    expect(s).toBe(before)
  })
})
