import { useFileTree, type DirEntry, type UseFileTreeResult } from './useFileTree'
import './FileExplorer.css'

interface Props {
  /** Project root whose tree is shown. */
  projectPath: string
  /** Path of the file currently open in the viewer, for highlighting. */
  activePath: string | null
  /** Open a real file from disk in the shared file viewer. */
  onOpenFile: (path: string) => void
}

function basename(p: string): string {
  const trimmed = p.replace(/[/\\]+$/, '')
  const parts = trimmed.split(/[/\\]/)
  return parts[parts.length - 1] || p
}

/**
 * IDE-style file explorer for the currently open project. Renders a lazy
 * directory tree (see `useFileTree`); clicking a file opens the real file on
 * disk in the shared file viewer.
 */
export function FileExplorer({ projectPath, activePath, onOpenFile }: Props) {
  const tree = useFileTree(projectPath)
  const rootChildren = tree.childrenByDir[projectPath]
  const rootLoading = tree.loading.has(projectPath)
  const rootError = tree.errors[projectPath]

  return (
    <aside className="file-explorer">
      <div className="file-explorer__header">
        <span className="file-explorer__title" title={projectPath}>
          {basename(projectPath)}
        </span>
        <button
          type="button"
          className="file-explorer__refresh"
          onClick={() => tree.reload(projectPath)}
          title="새로고침"
          aria-label="새로고침"
        >
          ↻
        </button>
      </div>
      <div className="file-explorer__body">
        {rootError && (
          <div className="file-explorer__error">⚠ {rootError}</div>
        )}
        {rootLoading && !rootChildren && (
          <div className="file-explorer__hint">불러오는 중…</div>
        )}
        {rootChildren && rootChildren.length === 0 && (
          <div className="file-explorer__hint">빈 폴더입니다.</div>
        )}
        {rootChildren?.map((entry) => (
          <TreeNode
            key={entry.path}
            entry={entry}
            depth={0}
            tree={tree}
            activePath={activePath}
            onOpenFile={onOpenFile}
          />
        ))}
      </div>
    </aside>
  )
}

interface TreeNodeProps {
  entry: DirEntry
  depth: number
  tree: UseFileTreeResult
  activePath: string | null
  onOpenFile: (path: string) => void
}

function TreeNode({ entry, depth, tree, activePath, onOpenFile }: TreeNodeProps) {
  const isExpanded = entry.is_dir && tree.expanded.has(entry.path)
  const isLoading = tree.loading.has(entry.path)
  const childError = tree.errors[entry.path]
  const children = tree.childrenByDir[entry.path]
  const isActive = !entry.is_dir && activePath === entry.path
  // 6px base inset + 14px per depth level keeps nested rows readable.
  const indent = 6 + depth * 14
  const childIndent = 6 + (depth + 1) * 14

  const handleClick = () => {
    if (entry.is_dir) tree.toggle(entry.path)
    else onOpenFile(entry.path)
  }

  return (
    <>
      <div
        className={
          'file-explorer__row' +
          (entry.is_dir ? ' is-dir' : '') +
          (isActive ? ' is-active' : '')
        }
        style={{ paddingLeft: indent }}
        onClick={handleClick}
        title={entry.name}
      >
        <span className="file-explorer__twisty">
          {entry.is_dir ? (isExpanded ? '▾' : '▸') : ''}
        </span>
        <span className="file-explorer__icon">
          {entry.is_dir ? '📁' : '📄'}
        </span>
        <span className="file-explorer__name">{entry.name}</span>
      </div>
      {isExpanded && (
        <>
          {childError && (
            <div
              className="file-explorer__error"
              style={{ paddingLeft: childIndent }}
            >
              ⚠ {childError}
            </div>
          )}
          {isLoading && !children && (
            <div
              className="file-explorer__hint"
              style={{ paddingLeft: childIndent }}
            >
              …
            </div>
          )}
          {children?.map((child) => (
            <TreeNode
              key={child.path}
              entry={child}
              depth={depth + 1}
              tree={tree}
              activePath={activePath}
              onOpenFile={onOpenFile}
            />
          ))}
        </>
      )}
    </>
  )
}
