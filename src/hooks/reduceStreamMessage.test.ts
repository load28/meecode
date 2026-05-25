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

  it('Task attach 지시 턴은 늦게 도착한 echo로 분리되지 않고, 도구호출+tool_result가 한 페어에 모인다', () => {
    // Optimistic directive pair (created by flushOne on the frontend).
    const directive = '[Task 컨텍스트 주입: My Task]\n\n... task_id="t1" ...'
    let s = makeInitialMessageState([
      { id: 'local-1', user_text: directive, segments: [], timestamp: 't' },
    ])
    // Model calls load_task_context — tool_use streams into the directive pair.
    s = reduceStreamMessage(
      s,
      assistant([
        {
          type: 'tool_use',
          id: 'tu1',
          name: 'mcp__meecode__load_task_context',
          input: { task_id: 't1' },
        },
      ]),
    )
    // CLI echoes the directive *after* the tool_use already landed. Before the
    // fix this opened a duplicate pair and stole `currentId`, so the following
    // tool_result was stranded in a second card.
    s = reduceStreamMessage(s, user('u-echo', directive))
    // The tool's context arrives as a tool_result-only user message.
    s = reduceStreamMessage(
      s,
      user('u-tr', [{ type: 'tool_result', tool_use_id: 'tu1', content: '컨텍스트' }]),
    )
    expect(s.pairs).toHaveLength(1)
    expect(s.pairs[0].id).toBe('local-1')
    expect(s.pairs[0].segments).toEqual([
      {
        kind: 'tool_use',
        id: 'tu1',
        name: 'mcp__meecode__load_task_context',
        summary: 't1',
        input: { task_id: 't1' },
      },
      { kind: 'tool_result', tool_use_id: 'tu1', text: '컨텍스트', is_error: false },
    ])
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

  it('content_block_stop이 text에 누락된 채 aggregated가 도착해도 thinking과 text 모두 보존', () => {
    // 회귀: 사용자가 보고한 "thinking은 남는데 마지막 답변이 없어진다" 증상.
    // 이전 로직은 partial:true text를 drop한 뒤 thinking이 streamed라는
    // 이유만으로 agg.text까지 strip해 답변이 통째로 사라졌다.
    let s = startPair()
    s = reduceStreamPartial(
      s,
      { event: { type: 'content_block_start', content_block: { type: 'thinking', thinking: '' } } },
      1_000,
    )
    s = reduceStreamPartial(s, {
      event: { type: 'content_block_delta', delta: { type: 'thinking_delta', thinking: 'plan' } },
    })
    s = reduceStreamPartial(s, { event: { type: 'content_block_stop' } }, 2_000)
    s = reduceStreamPartial(s, {
      event: { type: 'content_block_start', content_block: { type: 'text', text: '' } },
    })
    s = reduceStreamPartial(s, {
      event: { type: 'content_block_delta', delta: { type: 'text_delta', text: '답변 일부' } },
    })
    // content_block_stop이 text에 대해 도착하지 않은 시점에 aggregated가 도착.
    s = reduceStreamMessage(
      s,
      assistant([
        { type: 'thinking', thinking: 'plan' },
        { type: 'text', text: '답변 일부 + 마무리' },
      ]),
    )
    expect(s.pairs[0].segments).toEqual([
      { kind: 'thinking', text: 'plan', partial: false, duration_ms: 1_000 },
      { kind: 'text', text: '답변 일부 + 마무리' },
    ])
  })

  it('multi-tool 턴에서 streamed thinking·text 사이의 tool_use가 올바른 순서로 삽입', () => {
    // assistant 한 턴 안에서 thinking → text → tool_use → text2 → tool_use2 시퀀스.
    // text/thinking만 stream되고 tool_use는 aggregated로만 들어오는 경우에도
    // 블록 순서가 보존되어야 한다.
    let s = startPair()
    // 첫 thinking 스트림
    s = reduceStreamPartial(
      s,
      { event: { type: 'content_block_start', content_block: { type: 'thinking', thinking: '' } } },
      1_000,
    )
    s = reduceStreamPartial(s, {
      event: { type: 'content_block_delta', delta: { type: 'thinking_delta', thinking: 't' } },
    })
    s = reduceStreamPartial(s, { event: { type: 'content_block_stop' } }, 1_500)
    // 첫 text 스트림
    s = reduceStreamPartial(s, {
      event: { type: 'content_block_start', content_block: { type: 'text', text: '' } },
    })
    s = reduceStreamPartial(s, {
      event: { type: 'content_block_delta', delta: { type: 'text_delta', text: 'a' } },
    })
    s = reduceStreamPartial(s, { event: { type: 'content_block_stop' } })
    // 두 번째 text 스트림 (사이의 tool_use는 stream 안 됨)
    s = reduceStreamPartial(s, {
      event: { type: 'content_block_start', content_block: { type: 'text', text: '' } },
    })
    s = reduceStreamPartial(s, {
      event: { type: 'content_block_delta', delta: { type: 'text_delta', text: 'b' } },
    })
    s = reduceStreamPartial(s, { event: { type: 'content_block_stop' } })
    // aggregated 도착
    s = reduceStreamMessage(
      s,
      assistant([
        { type: 'thinking', thinking: 't' },
        { type: 'text', text: 'a' },
        { type: 'tool_use', id: 'tu-1', name: 'Bash', input: { command: 'ls' } },
        { type: 'text', text: 'b' },
        { type: 'tool_use', id: 'tu-2', name: 'Read', input: { file_path: '/x' } },
      ]),
    )
    expect(s.pairs[0].segments).toEqual([
      { kind: 'thinking', text: 't', partial: false, duration_ms: 500 },
      { kind: 'text', text: 'a', partial: false },
      {
        kind: 'tool_use',
        id: 'tu-1',
        name: 'Bash',
        summary: 'ls',
        input: { command: 'ls' },
      },
      { kind: 'text', text: 'b', partial: false },
      {
        kind: 'tool_use',
        id: 'tu-2',
        name: 'Read',
        summary: '/x',
        input: { file_path: '/x' },
      },
    ])
  })

  it('Claude Code SDK 인크리멘탈 session:message — 비어있는 thinking msg → 이어지는 text msg가 최종 답변으로 보존', () => {
    // 실 로그 재현 시나리오:
    //   1) content_block_start thinking → signature_delta만 옴 (extended
    //      thinking, 본문 텍스트 없음)
    //   2) session:message {kinds:[thinking[len=0]]} 도착 → 빈 thinking은
    //      assistantSegmentsFrom이 필터링 → segs=[] 조기 반환 (no-op)
    //   3) content_block_stop → thinking{partial:false, text:'', duration}
    //   4) content_block_start text → text{partial:true}
    //   5) text_delta로 누적 → text{partial:true, text:'553자...'}
    //   6) session:message {kinds:[text[len=553]]} 도착 (text의 stop이 오기 전)
    //     - dropTrailingLivePartials가 text{p:true} 제거
    //     - 이전 버전: mergeWithStreamedTail이 baseSegments[0]=thinking을
    //       agg.text 자리로 소모 → 텍스트 통째로 사라짐
    //     - 현재 버전: kind 미스매치 감지 → streamed thinking flush 후
    //       agg.text 추가
    let s = startPair()
    // (1)~(3) thinking partial 라이프사이클
    s = reduceStreamPartial(
      s,
      { event: { type: 'content_block_start', content_block: { type: 'thinking', thinking: '' } } },
      1_000,
    )
    // signature_delta는 reduceStreamPartial에서 무시됨 (text 누적 없음) — 별도 디스패치 생략
    // 첫 번째 session:message: 빈 thinking → no-op
    s = reduceStreamMessage(s, assistant([{ type: 'thinking', thinking: '' }]))
    expect(s.pairs[0].segments).toEqual([
      { kind: 'thinking', text: '', partial: true, duration_ms: 1_000 },
    ])
    s = reduceStreamPartial(s, { event: { type: 'content_block_stop' } }, 9_000)
    // (4)~(5) text 스트리밍
    s = reduceStreamPartial(s, {
      event: { type: 'content_block_start', content_block: { type: 'text', text: '' } },
    })
    s = reduceStreamPartial(s, {
      event: { type: 'content_block_delta', delta: { type: 'text_delta', text: '최종 답변 본문' } },
    })
    // (6) text의 stop 도착 전에 aggregated msg 도착
    s = reduceStreamMessage(s, assistant([{ type: 'text', text: '최종 답변 본문 전체' }]))
    expect(s.pairs[0].segments).toEqual([
      { kind: 'thinking', text: '', partial: false, duration_ms: 8_000 },
      { kind: 'text', text: '최종 답변 본문 전체' },
    ])
  })

  it('Skill 로드 echo는 새 pair 만들지 않고 현재 pair에 skill_body로 부착', () => {
    let s = makeInitialMessageState([])
    s = reduceStreamMessage(s, user('u1', 'Hono 라이브러리란?'))
    s = reduceStreamMessage(
      s,
      assistant([
        {
          type: 'tool_use',
          id: 'tu-skill',
          name: 'Skill',
          input: { skill: 'technical-documentation-standards' },
        },
      ]),
    )
    // CLI echoes back the loaded skill body as a user message.
    s = reduceStreamMessage(s, {
      kind: 'user',
      uuid: 'u-echo',
      body: {
        role: 'user',
        content:
          'Base directory for this skill: /Users/x/.claude/skills/technical-documentation-standards\n\n# Technical Documentation Standards\n## Overview\n...',
      },
    })
    expect(s.pairs).toHaveLength(1)
    expect(s.pairs[0].user_text).toBe('Hono 라이브러리란?')
    const last = s.pairs[0].segments.at(-1)
    expect(last).toEqual({
      kind: 'skill_body',
      skill: 'technical-documentation-standards',
      text:
        'Base directory for this skill: /Users/x/.claude/skills/technical-documentation-standards\n\n# Technical Documentation Standards\n## Overview\n...',
    })
  })

  it('Skill echo 패턴이 아니면 일반 user 메시지로 새 pair 생성 (기존 동작 유지)', () => {
    let s = makeInitialMessageState([])
    s = reduceStreamMessage(s, user('u1', 'q1'))
    s = reduceStreamMessage(s, assistant([{ type: 'text', text: 'a1' }]))
    // 일반 텍스트로 시작하는 follow-up user 메시지
    s = reduceStreamMessage(s, user('u2', '두 번째 질문'))
    expect(s.pairs).toHaveLength(2)
    expect(s.pairs[1].user_text).toBe('두 번째 질문')
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
