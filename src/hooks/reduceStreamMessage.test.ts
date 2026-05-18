import { describe, it, expect } from 'vitest'
import {
  reduceStreamMessage,
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

  it('tool_result-only user 메시지는 새 페어를 만들지 않는다', () => {
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

  it('tool_use는 tool_use segment로 들어간다', () => {
    let s = makeInitialMessageState([])
    s = reduceStreamMessage(s, user('u1', 'q'))
    s = reduceStreamMessage(
      s,
      assistant([{ type: 'tool_use', name: 'Bash', input: { command: 'ls -la' } }]),
    )
    expect(s.pairs[0].segments).toEqual([
      { kind: 'tool_use', name: 'Bash', summary: 'ls -la' },
    ])
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

  it('빈 content는 무시', () => {
    let s = makeInitialMessageState([])
    s = reduceStreamMessage(s, user('u1', 'q'))
    s = reduceStreamMessage(s, assistant([]))
    s = reduceStreamMessage(s, assistant([{ type: 'text', text: 'real' }]))
    expect(s.pairs[0].segments).toEqual([{ kind: 'text', text: 'real' }])
  })
})
