import { describe, it, expect } from 'vitest'
import { buildTaskContextMessage } from './taskContext'
import type { Source, Task } from '../types/task'

const task = (over: Partial<Task> = {}): Task => ({
  id: 't1',
  name: 'My Task',
  description: '',
  created_at_ms: 0,
  updated_at_ms: 0,
  ...over,
})

const src = (content: string, over: Partial<Source> = {}): Source => ({
  id: `s-${content.slice(0, 4)}`,
  task_id: 't1',
  kind: 'manual',
  content,
  origin: { session_id: null, qa_id: null, project_path: null },
  captured_at_ms: 0,
  ...over,
})

describe('buildTaskContextMessage', () => {
  it('returns null for an empty task (no desc, no sources)', () => {
    expect(buildTaskContextMessage(task(), [])).toBeNull()
  })

  it('description only — produces a header + body, no sources block', () => {
    const out = buildTaskContextMessage(task({ description: '핵심 결정 사항 정리' }), [])
    expect(out).not.toBeNull()
    expect(out).toContain('[Task 컨텍스트 주입: My Task]')
    expect(out).toContain('# My Task')
    expect(out).toContain('핵심 결정 사항 정리')
    expect(out).not.toContain('## Sources')
  })

  it('sources only — emits Sources block with kind markers', () => {
    const out = buildTaskContextMessage(task(), [
      src('답변 한 덩어리', { kind: 'qa_block' }),
      src('짧은 선택', { kind: 'selection' }),
    ])!
    expect(out).toContain('## Sources (2)')
    expect(out).toContain('### [1] qa_block')
    expect(out).toContain('답변 한 덩어리')
    expect(out).toContain('### [2] selection')
    expect(out).toContain('짧은 선택')
  })

  it('description with whitespace only is treated as empty', () => {
    expect(buildTaskContextMessage(task({ description: '   \n  ' }), [])).toBeNull()
  })

  it('combines description and sources in stable order', () => {
    const out = buildTaskContextMessage(
      task({ description: '설명' }),
      [src('소스1', { kind: 'manual' })],
    )!
    const descIdx = out.indexOf('설명')
    const srcIdx = out.indexOf('소스1')
    expect(descIdx).toBeGreaterThan(-1)
    expect(srcIdx).toBeGreaterThan(descIdx)
  })
})
