/**
 * Path helpers for the file explorer. Backend paths are OS-native — forward
 * slashes on unix, backslashes on Windows — so every helper tolerates both
 * separators, mirroring how VS Code's explorer works on either platform.
 */

/** Separator to use when joining onto `dir`: backslash only for pure Windows paths. */
export function pathSep(dir: string): '/' | '\\' {
  return dir.includes('\\') && !dir.includes('/') ? '\\' : '/'
}

export function basename(p: string): string {
  const trimmed = p.replace(/[/\\]+$/, '')
  const parts = trimmed.split(/[/\\]/)
  return parts[parts.length - 1] || p
}

/** Parent directory of `p`, keeping the root separator for top-level paths. */
export function parentPath(p: string): string {
  const trimmed = p.replace(/[/\\]+$/, '')
  const idx = Math.max(trimmed.lastIndexOf('/'), trimmed.lastIndexOf('\\'))
  if (idx < 0) return trimmed
  if (idx === 0) return trimmed.slice(0, 1)
  return trimmed.slice(0, idx)
}

export function joinPath(dir: string, name: string): string {
  const base = dir.replace(/[/\\]+$/, '')
  return base + pathSep(dir) + name
}

/** Whether `child` is `ancestor` itself or nested beneath it (either separator). */
export function isDescendantOrSelf(child: string, ancestor: string): boolean {
  return (
    child === ancestor ||
    child.startsWith(ancestor + '/') ||
    child.startsWith(ancestor + '\\')
  )
}
