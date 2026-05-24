import { describe, it, expect } from 'vitest'
import { totalTextChars, makePreview, deriveTitle } from './segmentHelpers'
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

  it('500자 초과 시 500자에서 자르고 말줄임표', () => {
    const long = 'a'.repeat(600)
    const out = makePreview(long)
    expect(out.length).toBe(501) // 500 + '…'
    expect(out.endsWith('…')).toBe(true)
  })

  it('6줄 이상이면 5줄까지만 + 말줄임표', () => {
    const six = 'line1\nline2\nline3\nline4\nline5\nline6'
    expect(makePreview(six)).toBe('line1\nline2\nline3\nline4\nline5…')
  })

  it('5줄이지만 500자 초과면 500자 우선', () => {
    const huge = 'a'.repeat(510) + '\nline2'
    const out = makePreview(huge)
    expect(out.length).toBe(501)
    expect(out.endsWith('…')).toBe(true)
  })

  it('text와 plan 세그먼트를 줄바꿈 두 칸으로 결합', () => {
    const combined = ['first text', 'plan body'].join('\n\n')
    expect(makePreview(combined)).toBe('first text\n\nplan body')
  })
})

describe('deriveTitle', () => {
  it('첫 의미 있는 줄을 제목으로', () => {
    expect(deriveTitle('버그를 고치는 방법\n자세한 내용...')).toBe('버그를 고치는 방법')
  })

  it('마크다운 헤더/목록 마커를 벗긴다', () => {
    expect(deriveTitle('## 결정 사항')).toBe('결정 사항')
    expect(deriveTitle('- 첫 항목')).toBe('첫 항목')
    expect(deriveTitle('> 인용문')).toBe('인용문')
  })

  it('앞쪽 빈 줄을 건너뛴다', () => {
    expect(deriveTitle('\n\n  실제 제목')).toBe('실제 제목')
  })

  it('60자를 넘으면 잘라서 말줄임표', () => {
    const out = deriveTitle('가'.repeat(80))
    expect(out.endsWith('…')).toBe(true)
    expect([...out].length).toBe(61) // 60 + '…'
  })

  it('내용이 없으면 빈 문자열', () => {
    expect(deriveTitle('   \n  ')).toBe('')
  })
})
