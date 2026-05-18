import { describe, it, expect } from 'vitest'
import { totalTextChars, makePreview } from './segmentHelpers'
import type { AssistantSegment } from '../types'

const text = (s: string): AssistantSegment => ({ kind: 'text', text: s })
const plan = (s: string): AssistantSegment => ({ kind: 'plan', text: s })
const tool = (name: string, summary = ''): AssistantSegment => ({
  kind: 'tool_use',
  name,
  summary,
})

describe('totalTextChars', () => {
  it('text와 plan 세그먼트의 길이만 합산', () => {
    const segs = [text('hello'), tool('Bash', 'ls'), plan('plan body')]
    expect(totalTextChars(segs)).toBe('hello'.length + 'plan body'.length)
  })

  it('빈 배열은 0', () => {
    expect(totalTextChars([])).toBe(0)
  })

  it('tool_use만 있으면 0', () => {
    expect(totalTextChars([tool('Bash', 'ls')])).toBe(0)
  })

  it('한글 문자 수를 정확히 카운트', () => {
    expect(totalTextChars([text('안녕하세요')])).toBe(5)
  })
})

describe('makePreview', () => {
  it('짧은 문자열은 그대로 반환', () => {
    expect(makePreview('hello')).toBe('hello')
  })

  it('240자 초과 시 240자에서 자르고 말줄임표', () => {
    const long = 'a'.repeat(300)
    const out = makePreview(long)
    expect(out.length).toBe(241) // 240 + '…'
    expect(out.endsWith('…')).toBe(true)
  })

  it('4줄 이상이면 3줄까지만 + 말줄임표', () => {
    const four = 'line1\nline2\nline3\nline4'
    expect(makePreview(four)).toBe('line1\nline2\nline3…')
  })

  it('3줄이지만 240자 초과면 240자 우선', () => {
    const huge = 'a'.repeat(250) + '\nline2'
    const out = makePreview(huge)
    expect(out.length).toBe(241)
    expect(out.endsWith('…')).toBe(true)
  })

  it('text와 plan 세그먼트를 줄바꿈 두 칸으로 결합', () => {
    const combined = ['first text', 'plan body'].join('\n\n')
    expect(makePreview(combined)).toBe('first text\n\nplan body')
  })
})
