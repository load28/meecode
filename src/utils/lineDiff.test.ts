import { describe, it, expect } from 'vitest'
import { diffLines, diffStats, summarizeDiff } from './lineDiff'

describe('diffLines', () => {
  it('equal text → all equal ops', () => {
    const d = diffLines('a\nb\nc', 'a\nb\nc')
    expect(d.every((l) => l.op === 'equal')).toBe(true)
    expect(d).toHaveLength(3)
  })

  it('pure insertion at tail', () => {
    const d = diffLines('a\nb', 'a\nb\nc')
    expect(diffStats(d)).toEqual({ added: 1, removed: 0 })
    expect(d[d.length - 1]).toMatchObject({ op: 'insert', newLineNo: 3, text: 'c' })
  })

  it('pure deletion in the middle', () => {
    const d = diffLines('a\nb\nc', 'a\nc')
    expect(diffStats(d)).toEqual({ added: 0, removed: 1 })
    expect(d.find((l) => l.op === 'delete')).toMatchObject({ text: 'b' })
  })

  it('replacement counts as 1 added + 1 removed', () => {
    const d = diffLines('a\nb\nc', 'a\nB\nc')
    expect(diffStats(d)).toEqual({ added: 1, removed: 1 })
  })

  it('empty before → all inserts', () => {
    const d = diffLines('', 'a\nb')
    expect(diffStats(d)).toEqual({ added: 2, removed: 0 })
    expect(d.every((l) => l.op === 'insert')).toBe(true)
  })

  it('empty after → all deletes', () => {
    const d = diffLines('a\nb', '')
    expect(diffStats(d)).toEqual({ added: 0, removed: 2 })
  })
})

describe('summarizeDiff', () => {
  it('both zero', () => {
    expect(summarizeDiff({ added: 0, removed: 0 })).toBe('No changes')
  })
  it('singular line count', () => {
    expect(summarizeDiff({ added: 1, removed: 0 })).toBe('Added 1 line')
    expect(summarizeDiff({ added: 0, removed: 1 })).toBe('Removed 1 line')
  })
  it('plural and combined', () => {
    expect(summarizeDiff({ added: 3, removed: 2 })).toBe(
      'Added 3 lines, removed 2 lines',
    )
  })
})
