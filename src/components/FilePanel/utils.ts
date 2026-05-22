export function basename(p: string): string {
  const parts = p.split('/')
  return parts[parts.length - 1] || p
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / 1024 / 1024).toFixed(2)} MB`
}

/** Absolute character offset of `(node, offset)` inside `root`. */
export function offsetWithin(root: Node, node: Node, offset: number): number {
  let total = 0
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null)
  let cur: Node | null
  while ((cur = walker.nextNode())) {
    if (cur === node) return total + offset
    total += (cur.textContent ?? '').length
  }
  return total
}
