import { describe, expect, it } from 'vitest'
import {
  basename,
  isDescendantOrSelf,
  joinPath,
  parentPath,
  pathSep,
} from './paths'

describe('pathSep', () => {
  it('uses forward slash for unix paths', () => {
    expect(pathSep('/home/user/proj')).toBe('/')
  })
  it('uses backslash only for pure Windows paths', () => {
    expect(pathSep('C:\\Users\\me')).toBe('\\')
    // Mixed separators (rare) fall back to forward slash.
    expect(pathSep('C:/Users/me')).toBe('/')
  })
})

describe('basename', () => {
  it('returns the final segment for either separator', () => {
    expect(basename('/a/b/c.ts')).toBe('c.ts')
    expect(basename('C:\\a\\b\\c.ts')).toBe('c.ts')
  })
  it('ignores trailing separators', () => {
    expect(basename('/a/b/')).toBe('b')
  })
})

describe('parentPath', () => {
  it('drops the final segment', () => {
    expect(parentPath('/a/b/c.ts')).toBe('/a/b')
    expect(parentPath('C:\\a\\b')).toBe('C:\\a')
  })
  it('keeps the root separator for top-level paths', () => {
    expect(parentPath('/a')).toBe('/')
  })
  it('ignores trailing separators', () => {
    expect(parentPath('/a/b/')).toBe('/a')
  })
})

describe('joinPath', () => {
  it('joins with the directory’s separator', () => {
    expect(joinPath('/a/b', 'c.ts')).toBe('/a/b/c.ts')
    expect(joinPath('C:\\a', 'b.ts')).toBe('C:\\a\\b.ts')
  })
  it('normalises a trailing separator on the directory', () => {
    expect(joinPath('/a/b/', 'c.ts')).toBe('/a/b/c.ts')
  })
})

describe('isDescendantOrSelf', () => {
  it('matches the path itself and nested children', () => {
    expect(isDescendantOrSelf('/a/b', '/a/b')).toBe(true)
    expect(isDescendantOrSelf('/a/b/c', '/a/b')).toBe(true)
    expect(isDescendantOrSelf('C:\\a\\b\\c', 'C:\\a\\b')).toBe(true)
  })
  it('does not match mere string prefixes', () => {
    expect(isDescendantOrSelf('/a/bc', '/a/b')).toBe(false)
    expect(isDescendantOrSelf('/a', '/a/b')).toBe(false)
  })
})
