/**
 * The current project root, used as the LSP workspace folder. Set by the main
 * layout when the active project changes. Kept in its own dependency-light
 * module so setting it doesn't pull the (lazy) LSP client bundle.
 */
let rootPath: string | null = null

export function setWorkspaceRoot(path: string | null): void {
  rootPath = path
}

export function getWorkspaceRootPath(): string | null {
  return rootPath
}
