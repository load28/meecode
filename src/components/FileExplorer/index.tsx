import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useFileTree, type DirEntry, type UseFileTreeResult } from './useFileTree'
import { getFileIcon } from './fileIcons'
import { basename, isDescendantOrSelf, joinPath, parentPath } from './paths'
import { useClickOutside } from '../../hooks/useClickOutside'
import './FileExplorer.css'

interface Props {
  /** Project root whose tree is shown. */
  projectPath: string
  /** Path of the file currently open in the viewer, for highlighting. */
  activePath: string | null
  /** Open a real file from disk in the shared file viewer. */
  onOpenFile: (path: string) => void
  /** Notify the host that `path` (file or dir) was deleted, so it can close tabs. */
  onPathDeleted?: (path: string) => void
  /** Notify the host that `from` was renamed/moved to `to`, so it can remap tabs. */
  onPathRenamed?: (from: string, to: string) => void
}

/** A pending New File / New Folder input awaiting a name. */
interface CreatingState {
  parentDir: string
  isDir: boolean
}

/** Open context menu: `entry` is null for the root / empty area. */
interface MenuState {
  x: number
  y: number
  entry: DirEntry | null
}

/**
 * IDE-style file explorer for the currently open project, modelled on VS
 * Code's Explorer. Renders a lazy directory tree (see `useFileTree`) and
 * supports the same set of operations VS Code's explorer exposes: collapse
 * all, create file/folder (inline input), rename (inline input), delete (with
 * confirmation), and drag-and-drop move. Mutations go through the backend and
 * the tree refreshes from the file watcher's delta, exactly as VS Code's
 * explorer updates from filesystem events rather than mutating optimistically.
 */
export function FileExplorer({
  projectPath,
  activePath,
  onOpenFile,
  onPathDeleted,
  onPathRenamed,
}: Props) {
  const tree = useFileTree(projectPath)
  const rootChildren = tree.childrenByDir[projectPath]
  const rootLoading = tree.loading.has(projectPath)
  const rootError = tree.errors[projectPath]

  const [selected, setSelected] = useState<DirEntry | null>(null)
  const [creating, setCreating] = useState<CreatingState | null>(null)
  const [renaming, setRenaming] = useState<string | null>(null)
  const [menu, setMenu] = useState<MenuState | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [dragOverDir, setDragOverDir] = useState<string | null>(null)
  const draggingPath = useRef<string | null>(null)
  const asideRef = useRef<HTMLElement>(null)

  // Reset transient interaction state whenever the project changes.
  useEffect(() => {
    setSelected(null)
    setCreating(null)
    setRenaming(null)
    setMenu(null)
    setActionError(null)
    setDragOverDir(null)
  }, [projectPath])

  const fail = useCallback((e: unknown) => setActionError(String(e)), [])

  // Folder a New File/Folder should land in: the selected folder, the parent
  // of a selected file, or the root when nothing is selected — VS Code's
  // target-resolution for its toolbar New File/Folder actions.
  const targetDirFor = useCallback(
    (entry: DirEntry | null): string => {
      if (!entry) return projectPath
      return entry.is_dir ? entry.path : parentPath(entry.path)
    },
    [projectPath],
  )

  const beginCreate = useCallback(
    (entry: DirEntry | null, isDir: boolean) => {
      const parentDir = targetDirFor(entry)
      setRenaming(null)
      setActionError(null)
      if (parentDir !== projectPath) tree.expand(parentDir)
      setCreating({ parentDir, isDir })
    },
    [projectPath, targetDirFor, tree],
  )

  const submitCreate = useCallback(
    (name: string) => {
      const cur = creating
      setCreating(null)
      const trimmed = name.trim()
      if (!cur || !trimmed) return
      tree.create(cur.parentDir, trimmed, cur.isDir).catch(fail)
    },
    [creating, tree, fail],
  )

  const beginRename = useCallback((entry: DirEntry) => {
    setCreating(null)
    setActionError(null)
    setRenaming(entry.path)
  }, [])

  const submitRename = useCallback(
    (path: string, name: string) => {
      setRenaming(null)
      const trimmed = name.trim()
      if (!trimmed || trimmed === basename(path)) return
      const to = joinPath(parentPath(path), trimmed)
      tree
        .rename(path, trimmed)
        .then(() => {
          setSelected(null)
          onPathRenamed?.(path, to)
        })
        .catch(fail)
    },
    [tree, fail, onPathRenamed],
  )

  const handleDelete = useCallback(
    (entry: DirEntry) => {
      setMenu(null)
      const kind = entry.is_dir ? '폴더' : '파일'
      if (!confirm(`${kind} "${entry.name}"을(를) 삭제하시겠습니까?`)) return
      tree
        .remove(entry.path)
        .then(() => {
          setSelected(null)
          onPathDeleted?.(entry.path)
        })
        .catch(fail)
    },
    [tree, fail, onPathDeleted],
  )

  const handleMove = useCallback(
    (from: string, targetDir: string) => {
      // No-op or invalid drops: into the same parent, onto itself, or into a
      // descendant of the dragged folder. VS Code rejects these identically.
      if (parentPath(from) === targetDir) return
      if (isDescendantOrSelf(targetDir, from)) return
      tree
        .move(from, targetDir)
        .then(() => {
          setSelected(null)
          onPathRenamed?.(from, joinPath(targetDir, basename(from)))
        })
        .catch(fail)
    },
    [tree, fail, onPathRenamed],
  )

  // Keyboard: F2 renames the selection, Delete removes it — but only when no
  // inline input has focus (those handle their own keys).
  const onKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (document.activeElement?.tagName === 'INPUT') return
      if (!selected) return
      if (e.key === 'F2') {
        e.preventDefault()
        beginRename(selected)
      } else if (e.key === 'Delete') {
        e.preventDefault()
        handleDelete(selected)
      }
    },
    [selected, beginRename, handleDelete],
  )

  const ctx: ExplorerCtx = {
    tree,
    activePath,
    selectedPath: selected?.path ?? null,
    creating,
    renaming,
    dragOverDir,
    onSelect: (entry) => {
      setSelected(entry)
      // Pull keyboard focus into the tree so F2 / Delete shortcuts apply.
      asideRef.current?.focus()
    },
    onOpenFile,
    onContextMenu: (e, entry) => {
      e.preventDefault()
      if (entry) setSelected(entry)
      // Clamp so the menu stays on-screen near the bottom/right edges.
      const x = Math.min(e.clientX, window.innerWidth - 180)
      const y = Math.min(e.clientY, window.innerHeight - 160)
      setMenu({ x, y, entry })
    },
    onSubmitRename: submitRename,
    onCancelRename: () => setRenaming(null),
    onSubmitCreate: submitCreate,
    onCancelCreate: () => setCreating(null),
    onDragStart: (path) => {
      draggingPath.current = path
    },
    onDragEnd: () => {
      draggingPath.current = null
      setDragOverDir(null)
    },
    onDragOverDir: (e, dir) => {
      if (draggingPath.current === null) return
      e.preventDefault()
      e.dataTransfer.dropEffect = 'move'
      setDragOverDir(dir)
    },
    onDropDir: (e, dir) => {
      e.preventDefault()
      const from = draggingPath.current
      draggingPath.current = null
      setDragOverDir(null)
      if (from) handleMove(from, dir)
    },
  }

  const rootDragActive = dragOverDir === projectPath

  return (
    <aside
      ref={asideRef}
      className="file-explorer"
      onKeyDown={onKeyDown}
      tabIndex={-1}
    >
      <div className="file-explorer__header">
        <span className="file-explorer__title" title={projectPath}>
          {basename(projectPath)}
        </span>
        <div className="file-explorer__actions">
          <button
            type="button"
            className="file-explorer__action"
            onClick={() => beginCreate(selected, false)}
            title="새 파일"
            aria-label="새 파일"
          >
            <NewFileIcon />
          </button>
          <button
            type="button"
            className="file-explorer__action"
            onClick={() => beginCreate(selected, true)}
            title="새 폴더"
            aria-label="새 폴더"
          >
            <NewFolderIcon />
          </button>
          <button
            type="button"
            className="file-explorer__action"
            onClick={() => tree.reload(projectPath)}
            title="새로고침"
            aria-label="새로고침"
          >
            ↻
          </button>
          <button
            type="button"
            className="file-explorer__action"
            onClick={tree.collapseAll}
            title="모두 접기"
            aria-label="모두 접기"
          >
            <CollapseAllIcon />
          </button>
        </div>
      </div>
      <div
        className={
          'file-explorer__body' + (rootDragActive ? ' is-drop-target' : '')
        }
        onDragOver={(e) => ctx.onDragOverDir(e, projectPath)}
        onDrop={(e) => ctx.onDropDir(e, projectPath)}
        onClick={(e) => {
          // A click on the empty body clears the selection.
          if (e.target === e.currentTarget) setSelected(null)
        }}
        onContextMenu={(e) => {
          if (e.target === e.currentTarget) ctx.onContextMenu(e, null)
        }}
      >
        {actionError && (
          <div className="file-explorer__error" role="alert">
            ⚠ {actionError}
            <button
              type="button"
              className="file-explorer__error-dismiss"
              onClick={() => setActionError(null)}
              aria-label="닫기"
            >
              ×
            </button>
          </div>
        )}
        {creating?.parentDir === projectPath && (
          <CreateInput
            isDir={creating.isDir}
            depth={0}
            onSubmit={submitCreate}
            onCancel={() => setCreating(null)}
          />
        )}
        {rootError && <div className="file-explorer__error">⚠ {rootError}</div>}
        {rootLoading && !rootChildren && (
          <div className="file-explorer__hint">불러오는 중…</div>
        )}
        {rootChildren && rootChildren.length === 0 && !creating && (
          <div className="file-explorer__hint">빈 폴더입니다.</div>
        )}
        {rootChildren?.map((entry) => (
          <TreeNode key={entry.path} entry={entry} depth={0} ctx={ctx} />
        ))}
      </div>
      {menu && (
        <ContextMenu
          state={menu}
          onClose={() => setMenu(null)}
          onNewFile={(entry) => {
            setMenu(null)
            beginCreate(entry, false)
          }}
          onNewFolder={(entry) => {
            setMenu(null)
            beginCreate(entry, true)
          }}
          onRename={(entry) => {
            setMenu(null)
            beginRename(entry)
          }}
          onDelete={handleDelete}
        />
      )}
    </aside>
  )
}

interface ExplorerCtx {
  tree: UseFileTreeResult
  activePath: string | null
  selectedPath: string | null
  creating: CreatingState | null
  renaming: string | null
  dragOverDir: string | null
  onSelect: (entry: DirEntry) => void
  onOpenFile: (path: string) => void
  onContextMenu: (e: React.MouseEvent, entry: DirEntry | null) => void
  onSubmitRename: (path: string, name: string) => void
  onCancelRename: () => void
  onSubmitCreate: (name: string) => void
  onCancelCreate: () => void
  onDragStart: (path: string) => void
  onDragEnd: () => void
  onDragOverDir: (e: React.DragEvent, dir: string) => void
  onDropDir: (e: React.DragEvent, dir: string) => void
}

function FileIconView({
  entry,
  isExpanded,
}: {
  entry: DirEntry
  isExpanded: boolean
}) {
  const icon = getFileIcon(entry.name, entry.is_dir, isExpanded)
  return (
    <span
      className={'file-explorer__icon' + (icon.seti ? ' is-seti' : '')}
      style={icon.color ? { color: icon.color } : undefined}
      aria-hidden="true"
    >
      {icon.char}
    </span>
  )
}

interface TreeNodeProps {
  entry: DirEntry
  depth: number
  ctx: ExplorerCtx
}

function TreeNode({ entry, depth, ctx }: TreeNodeProps) {
  const { tree } = ctx
  const isExpanded = entry.is_dir && tree.expanded.has(entry.path)
  const isLoading = tree.loading.has(entry.path)
  const childError = tree.errors[entry.path]
  const children = tree.childrenByDir[entry.path]
  const isActive = !entry.is_dir && ctx.activePath === entry.path
  const isSelected = ctx.selectedPath === entry.path
  const isDropTarget = entry.is_dir && ctx.dragOverDir === entry.path
  const isRenaming = ctx.renaming === entry.path
  // 6px base inset + 14px per depth level keeps nested rows readable.
  const indent = 6 + depth * 14
  const childIndent = 6 + (depth + 1) * 14
  // Drag-and-drop targets a folder directly, or a file's parent folder.
  const dropDir = entry.is_dir ? entry.path : parentPath(entry.path)

  const handleClick = () => {
    ctx.onSelect(entry)
    if (entry.is_dir) tree.toggle(entry.path)
    else ctx.onOpenFile(entry.path)
  }

  return (
    <>
      <div
        className={
          'file-explorer__row' +
          (entry.is_dir ? ' is-dir' : '') +
          (isActive ? ' is-active' : '') +
          (isSelected ? ' is-selected' : '') +
          (isDropTarget ? ' is-drop-target' : '')
        }
        style={{ paddingLeft: indent }}
        onClick={handleClick}
        onContextMenu={(e) => {
          e.stopPropagation()
          ctx.onContextMenu(e, entry)
        }}
        draggable={!isRenaming}
        onDragStart={(e) => {
          e.dataTransfer.effectAllowed = 'move'
          e.dataTransfer.setData('text/plain', entry.path)
          ctx.onDragStart(entry.path)
        }}
        onDragEnd={ctx.onDragEnd}
        onDragOver={(e) => {
          e.stopPropagation()
          ctx.onDragOverDir(e, dropDir)
        }}
        onDrop={(e) => {
          e.stopPropagation()
          ctx.onDropDir(e, dropDir)
        }}
        title={entry.name}
      >
        <span className="file-explorer__twisty">
          {entry.is_dir ? (isExpanded ? '▾' : '▸') : ''}
        </span>
        <FileIconView entry={entry} isExpanded={isExpanded} />
        {isRenaming ? (
          <InlineInput
            initialValue={entry.name}
            selectStem
            onSubmit={(v) => ctx.onSubmitRename(entry.path, v)}
            onCancel={ctx.onCancelRename}
          />
        ) : (
          <span className="file-explorer__name">{entry.name}</span>
        )}
      </div>
      {isExpanded && (
        <>
          {ctx.creating?.parentDir === entry.path && (
            <CreateInput
              isDir={ctx.creating.isDir}
              depth={depth + 1}
              onSubmit={ctx.onSubmitCreate}
              onCancel={ctx.onCancelCreate}
            />
          )}
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
            <TreeNode key={child.path} entry={child} depth={depth + 1} ctx={ctx} />
          ))}
        </>
      )}
    </>
  )
}

/** Inline new-file / new-folder input rendered as a tree row. */
function CreateInput({
  isDir,
  depth,
  onSubmit,
  onCancel,
}: {
  isDir: boolean
  depth: number
  onSubmit: (name: string) => void
  onCancel: () => void
}) {
  const indent = 6 + depth * 14
  return (
    <div
      className="file-explorer__row file-explorer__row--input"
      style={{ paddingLeft: indent }}
    >
      <span className="file-explorer__twisty" />
      <span className="file-explorer__icon" aria-hidden="true">
        {isDir ? '📁' : '📄'}
      </span>
      <InlineInput initialValue="" onSubmit={onSubmit} onCancel={onCancel} />
    </div>
  )
}

/**
 * Focused text input used for inline create/rename. Commits on Enter or blur,
 * cancels on Escape — VS Code's tree input box behaviour. For rename,
 * `selectStem` pre-selects the basename without its extension.
 */
function InlineInput({
  initialValue,
  selectStem = false,
  onSubmit,
  onCancel,
}: {
  initialValue: string
  selectStem?: boolean
  onSubmit: (value: string) => void
  onCancel: () => void
}) {
  const ref = useRef<HTMLInputElement>(null)
  const done = useRef(false)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    el.focus()
    const dot = initialValue.lastIndexOf('.')
    if (selectStem && dot > 0) el.setSelectionRange(0, dot)
    else el.select()
  }, [initialValue, selectStem])

  const finish = (commit: boolean) => {
    if (done.current) return
    done.current = true
    if (commit) onSubmit(ref.current?.value ?? '')
    else onCancel()
  }

  return (
    <input
      ref={ref}
      className="file-explorer__input"
      type="text"
      defaultValue={initialValue}
      spellCheck={false}
      autoComplete="off"
      onClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        e.stopPropagation()
        if (e.key === 'Enter') {
          e.preventDefault()
          finish(true)
        } else if (e.key === 'Escape') {
          e.preventDefault()
          finish(false)
        }
      }}
      onBlur={() => finish(true)}
    />
  )
}

function ContextMenu({
  state,
  onClose,
  onNewFile,
  onNewFolder,
  onRename,
  onDelete,
}: {
  state: MenuState
  onClose: () => void
  onNewFile: (entry: DirEntry | null) => void
  onNewFolder: (entry: DirEntry | null) => void
  onRename: (entry: DirEntry) => void
  onDelete: (entry: DirEntry) => void
}) {
  const ref = useRef<HTMLDivElement>(null)
  useClickOutside(ref, true, onClose)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  const { entry } = state
  return createPortal(
    <div
      ref={ref}
      className="file-explorer__menu"
      style={{ left: state.x, top: state.y }}
      role="menu"
    >
      <button
        type="button"
        className="file-explorer__menu-item"
        onClick={() => onNewFile(entry)}
      >
        새 파일
      </button>
      <button
        type="button"
        className="file-explorer__menu-item"
        onClick={() => onNewFolder(entry)}
      >
        새 폴더
      </button>
      {entry && (
        <>
          <div className="file-explorer__menu-sep" />
          <button
            type="button"
            className="file-explorer__menu-item"
            onClick={() => onRename(entry)}
          >
            이름 바꾸기
          </button>
          <button
            type="button"
            className="file-explorer__menu-item file-explorer__menu-item--danger"
            onClick={() => onDelete(entry)}
          >
            삭제
          </button>
        </>
      )}
    </div>,
    document.body,
  )
}

function NewFileIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path
        d="M9 1.5H4.5A1.5 1.5 0 0 0 3 3v10A1.5 1.5 0 0 0 4.5 14.5H8"
        stroke="currentColor"
        strokeWidth="1.1"
        strokeLinecap="round"
      />
      <path d="M9 1.5 12.5 5M9 1.5V5h3.5" stroke="currentColor" strokeWidth="1.1" strokeLinejoin="round" />
      <path d="M12 9.5v5M9.5 12h5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
    </svg>
  )
}

function NewFolderIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path
        d="M1.5 4.5 1.5 12A1 1 0 0 0 2.5 13H8"
        stroke="currentColor"
        strokeWidth="1.1"
        strokeLinecap="round"
      />
      <path
        d="M1.5 4.5V3.8A1 1 0 0 1 2.5 2.8H6l1.5 1.7H13a1 1 0 0 1 1 1V8"
        stroke="currentColor"
        strokeWidth="1.1"
        strokeLinejoin="round"
      />
      <path d="M12 9.5v5M9.5 12h5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
    </svg>
  )
}

function CollapseAllIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path
        d="M5 4.5 7.2 6.7a.5.5 0 0 0 .7 0L10 4.5M5 11.5l2.2-2.2a.5.5 0 0 1 .7 0l2.1 2.2"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}
