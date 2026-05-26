import { describe, expect, it } from 'vitest'
import { applyContentChanges, type DocChange } from './protocol'

// Monaco emits content changes end-of-document first; the host applies them in
// array order using their original offsets, so earlier offsets stay valid.
const change = (rangeOffset: number, rangeLength: number, text: string): DocChange => ({
  range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } },
  rangeOffset,
  rangeLength,
  text,
})

describe('applyContentChanges (host shadow document)', () => {
  it('applies a single insertion', () => {
    expect(applyContentChanges('hello world', [change(5, 0, ' there')])).toBe(
      'hello there world',
    )
  })

  it('applies a replacement', () => {
    expect(applyContentChanges('const x = 1', [change(6, 1, 'yy')])).toBe('const yy = 1')
  })

  it('applies a deletion', () => {
    expect(applyContentChanges('abcdef', [change(2, 2, '')])).toBe('abef')
  })

  it('applies multiple changes in Monaco end-first order without re-basing', () => {
    // "abcXYZdef" → delete "XYZ" (offset 3, len 3) and insert "!" at offset 0.
    // Monaco gives the later (higher-offset) edit first.
    const out = applyContentChanges('abcXYZdef', [change(3, 3, ''), change(0, 0, '!')])
    expect(out).toBe('!abcdef')
  })

  it('returns the input unchanged for an empty change set', () => {
    expect(applyContentChanges('unchanged', [])).toBe('unchanged')
  })
})
