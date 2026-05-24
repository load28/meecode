import { describe, it, expect } from 'vitest'
import { sourceTitle } from './sourceTitle'
import type { Source } from '../types/task'

const src = (over: Partial<Source>): Source => ({
  id: 's1',
  task_id: 't1',
  kind: 'manual',
  title: '',
  content: '',
  origin: { session_id: null, qa_id: null, project_path: null },
  captured_at_ms: 0,
  ...over,
})

describe('sourceTitle', () => {
  it('명시적 title이 있으면 그대로 사용', () => {
    expect(sourceTitle(src({ title: '핵심 결정' }))).toBe('핵심 결정')
  })

  it('공백 title은 무시하고 fallback', () => {
    expect(sourceTitle(src({ title: '   ', content: '선택한 텍스트' }))).toBe(
      '선택한 텍스트',
    )
  })

  it('qa_block은 ## Q 마커가 아닌 질문 줄에서 파생', () => {
    const s = src({
      kind: 'qa_block',
      content: '## Q\n로그인 버그 원인은?\n\n## A\n세션 만료 때문',
    })
    expect(sourceTitle(s)).toBe('로그인 버그 원인은?')
  })

  it('내용이 비면 기본 라벨', () => {
    expect(sourceTitle(src({ content: '' }))).toBe('제목 없는 Source')
  })
})
