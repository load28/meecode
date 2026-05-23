import { DiffView } from '../DiffView'
import {
  FilePath,
  pickArray,
  pickString,
  withPending,
  type ToolViewProps,
} from './_shared'

export function EditView({ segment, onOpenFile, defaultOpen }: ToolViewProps) {
  const filePath = pickString(segment.input, 'file_path')
  const oldStr = pickString(segment.input, 'old_string')
  const newStr = pickString(segment.input, 'new_string')
  const openWithDiff = withPending(onOpenFile, {
    kind: 'edit',
    oldText: oldStr,
    newText: newStr,
  })
  return (
    <div className="tool-view tool-view--edit">
      <header className="tool-view__header">
        <span className="tool-view__icon">✎</span>
        <span className="tool-view__name">Edit</span>
        <FilePath path={filePath} onOpen={openWithDiff} />
      </header>
      {(oldStr || newStr) && (
        <DiffView
          oldText={oldStr}
          newText={newStr}
          defaultOpen={defaultOpen}
          collapsibleLabel="변경 보기"
        />
      )}
    </div>
  )
}

export function MultiEditView({
  segment,
  onOpenFile,
  defaultOpen,
}: ToolViewProps) {
  const filePath = pickString(segment.input, 'file_path')
  const edits = pickArray(segment.input, 'edits') as Array<{
    old_string?: string
    new_string?: string
  }>
  const openWithDiff = withPending(onOpenFile, {
    kind: 'multiedit',
    oldText: edits
      .map((e) => (typeof e.old_string === 'string' ? e.old_string : ''))
      .join('\n'),
    newText: edits
      .map((e) => (typeof e.new_string === 'string' ? e.new_string : ''))
      .join('\n'),
    label: `${edits.length}개 변경`,
  })
  return (
    <div className="tool-view tool-view--edit">
      <header className="tool-view__header">
        <span className="tool-view__icon">✎</span>
        <span className="tool-view__name">MultiEdit</span>
        <FilePath path={filePath} onOpen={openWithDiff} />
        {edits.length > 0 && (
          <span className="tool-view__hint">{edits.length}개 변경</span>
        )}
      </header>
      {edits.map((e, i) => (
        <DiffView
          key={i}
          oldText={typeof e.old_string === 'string' ? e.old_string : ''}
          newText={typeof e.new_string === 'string' ? e.new_string : ''}
          defaultOpen={defaultOpen}
          collapsibleLabel={`변경 ${i + 1}`}
        />
      ))}
    </div>
  )
}

export function WriteView({ segment, onOpenFile, defaultOpen }: ToolViewProps) {
  const filePath = pickString(segment.input, 'file_path')
  const content = pickString(segment.input, 'content')
  const lineCount = content ? content.split('\n').length : 0
  const openWithDiff = withPending(onOpenFile, {
    kind: 'write',
    oldText: '',
    newText: content,
  })
  return (
    <div className="tool-view tool-view--write">
      <header className="tool-view__header">
        <span className="tool-view__icon">＋</span>
        <span className="tool-view__name">Write</span>
        <FilePath path={filePath} onOpen={openWithDiff} />
        {lineCount > 0 && (
          <span className="tool-view__hint">{lineCount} lines</span>
        )}
      </header>
      {content && (
        <DiffView
          oldText=""
          newText={content}
          defaultOpen={defaultOpen}
          collapsibleLabel="내용 보기"
        />
      )}
    </div>
  )
}

export function ReadView({ segment, onOpenFile }: ToolViewProps) {
  const filePath = pickString(segment.input, 'file_path')
  const offset = (segment.input as Record<string, unknown> | null)?.offset
  const limit = (segment.input as Record<string, unknown> | null)?.limit
  return (
    <div className="tool-view tool-view--read">
      <header className="tool-view__header">
        <span className="tool-view__icon">👁</span>
        <span className="tool-view__name">Read</span>
        <FilePath path={filePath} onOpen={onOpenFile} />
        {(typeof offset === 'number' || typeof limit === 'number') && (
          <span className="tool-view__hint">
            {typeof offset === 'number' ? `+${offset}` : ''}
            {typeof limit === 'number' ? ` ×${limit}` : ''}
          </span>
        )}
      </header>
    </div>
  )
}

export function NotebookEditView({ segment, defaultOpen }: ToolViewProps) {
  const path = pickString(segment.input, 'notebook_path')
  const cellId = pickString(segment.input, 'cell_id')
  const editMode = pickString(segment.input, 'edit_mode') || 'replace'
  const newSource = pickString(segment.input, 'new_source')
  return (
    <div className="tool-view tool-view--edit">
      <header className="tool-view__header">
        <span className="tool-view__icon">📓</span>
        <span className="tool-view__name">NotebookEdit</span>
        <span className="tool-view__path">{path}</span>
        <span className="tool-view__hint">
          {editMode}
          {cellId && ` · ${cellId.slice(0, 8)}`}
        </span>
      </header>
      {newSource && (
        <details className="tool-view__diff" open={defaultOpen}>
          <summary className="tool-view__diff-summary">셀 내용 보기</summary>
          <pre className="tool-view__code">{newSource}</pre>
        </details>
      )}
    </div>
  )
}
