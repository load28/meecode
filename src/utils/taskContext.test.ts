import { describe, it, expect } from 'vitest'
import {
  buildTaskContextDirective,
  buildTaskContextMessage,
  parseTaskContextMessage,
  TASK_CONTEXT_TOOL,
} from './taskContext'
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
  title: '',
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

  it('sources only — emits Sources block with title + kind markers', () => {
    const out = buildTaskContextMessage(task(), [
      src('답변 한 덩어리', { kind: 'qa_block', title: '핵심 답변' }),
      src('짧은 선택', { kind: 'selection' }),
    ])!
    expect(out).toContain('## Sources (2)')
    expect(out).toContain('### [1] 핵심 답변 · qa_block')
    expect(out).toContain('답변 한 덩어리')
    // No explicit title — falls back to a content-derived label.
    expect(out).toContain('### [2] 짧은 선택 · selection')
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

describe('buildTaskContextDirective', () => {
  it('renders as a context chip and names the tool to call', () => {
    const out = buildTaskContextDirective(task({ id: 'task-xyz', name: 'Refactor' }))
    // Starts with the prefix so TaskContextNote collapses it into a chip.
    expect(parseTaskContextMessage(out)).not.toBeNull()
    expect(parseTaskContextMessage(out)!.taskName).toBe('Refactor')
    expect(out).toContain(TASK_CONTEXT_TOOL)
  })

  it('embeds the exact task_id marker the fallback watcher matches on', () => {
    const out = buildTaskContextDirective(task({ id: 'task-xyz' }))
    expect(out).toContain('task_id="task-xyz"')
  })

  it('stays short — does not dump description or sources', () => {
    const out = buildTaskContextDirective(
      task({ id: 'task-xyz', name: 'Refactor', description: '아주 긴 설명'.repeat(20) }),
    )
    expect(out).not.toContain('## Sources')
    expect(out).not.toContain('아주 긴 설명')
  })
})

describe('parseTaskContextMessage', () => {
  it('round-trips name + source count from a built message', () => {
    const out = buildTaskContextMessage(task({ name: 'Refactor' }), [
      src('a', { kind: 'qa_block' }),
      src('b', { kind: 'selection' }),
    ])!
    const parsed = parseTaskContextMessage(out)
    expect(parsed).not.toBeNull()
    expect(parsed!.taskName).toBe('Refactor')
    expect(parsed!.sourceCount).toBe(2)
  })

  it('reports zero sources for a description-only injection', () => {
    const out = buildTaskContextMessage(task({ name: 'Notes', description: '설명' }), [])!
    const parsed = parseTaskContextMessage(out)
    expect(parsed!.taskName).toBe('Notes')
    expect(parsed!.sourceCount).toBe(0)
  })

  it('returns null for an ordinary user turn', () => {
    expect(parseTaskContextMessage('그냥 평범한 질문입니다')).toBeNull()
  })
})
