/**
 * Minimal line-level diff for Edit/Write previews. We avoid pulling in a
 * heavy `diff` package — line-level LCS is ~30 lines and good enough for
 * the inline preview. Side-by-side rendering happens in the component.
 */
export type DiffOp = 'equal' | 'insert' | 'delete'

export interface DiffLine {
  op: DiffOp
  oldLineNo?: number
  newLineNo?: number
  text: string
}

export interface DiffStats {
  added: number
  removed: number
}

/** Hunt–McIlroy LCS over lines. Returns the alignment as a flat op list. */
export function diffLines(a: string, b: string): DiffLine[] {
  const aLines = a === '' ? [] : a.split('\n')
  const bLines = b === '' ? [] : b.split('\n')
  const n = aLines.length
  const m = bLines.length
  // dp[i][j] = LCS length of aLines[i:] vs bLines[j:]
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0))
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      if (aLines[i] === bLines[j]) {
        dp[i][j] = dp[i + 1][j + 1] + 1
      } else {
        dp[i][j] = Math.max(dp[i + 1][j], dp[i][j + 1])
      }
    }
  }
  const out: DiffLine[] = []
  let i = 0
  let j = 0
  while (i < n && j < m) {
    if (aLines[i] === bLines[j]) {
      out.push({ op: 'equal', oldLineNo: i + 1, newLineNo: j + 1, text: aLines[i] })
      i++
      j++
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      out.push({ op: 'delete', oldLineNo: i + 1, text: aLines[i] })
      i++
    } else {
      out.push({ op: 'insert', newLineNo: j + 1, text: bLines[j] })
      j++
    }
  }
  while (i < n) {
    out.push({ op: 'delete', oldLineNo: i + 1, text: aLines[i] })
    i++
  }
  while (j < m) {
    out.push({ op: 'insert', newLineNo: j + 1, text: bLines[j] })
    j++
  }
  return out
}

export function diffStats(lines: DiffLine[]): DiffStats {
  let added = 0
  let removed = 0
  for (const l of lines) {
    if (l.op === 'insert') added++
    else if (l.op === 'delete') removed++
  }
  return { added, removed }
}

/**
 * Compact one-liner summary used as the diff header.
 * - "Added N lines, removed M lines"
 * - "Added N lines" / "Removed M lines"
 * - "No changes" if both are zero
 */
export function summarizeDiff({ added, removed }: DiffStats): string {
  if (added === 0 && removed === 0) return 'No changes'
  if (added === 0) return `Removed ${removed} line${removed === 1 ? '' : 's'}`
  if (removed === 0) return `Added ${added} line${added === 1 ? '' : 's'}`
  return `Added ${added} line${added === 1 ? '' : 's'}, removed ${removed} line${removed === 1 ? '' : 's'}`
}
