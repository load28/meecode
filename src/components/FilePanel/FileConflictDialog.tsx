import { useEffect, useRef, useState } from 'react'
import * as monaco from 'monaco-editor'
import type { FileConflict } from '../../hooks/useFileSave'
import {
  EDITOR_FONT_FAMILY,
  EDITOR_THEME,
  setupMonaco,
} from '../../editor/monacoSetup'
import { toMonacoLanguage } from '../../editor/models'
import { basename } from './utils'

interface Props {
  conflict: FileConflict
  onLoadDisk: () => void
  onKeepMemory: () => void
  onMerged: (merged: string) => void
  onDismiss: () => void
}

/**
 * IntelliJ "File Cache Conflict" dialog, surfaced when a save (or focus
 * refresh) finds the file changed on disk while the editor has unsaved edits.
 * Offers the same three resolutions IntelliJ does, with "Show Difference"
 * opening a side-by-side merge (filesystem left, memory right).
 */
export function FileConflictDialog({
  conflict,
  onLoadDisk,
  onKeepMemory,
  onMerged,
  onDismiss,
}: Props) {
  const [showDiff, setShowDiff] = useState(false)
  const name = basename(conflict.path)

  if (showDiff) {
    return (
      <ConflictDiff
        conflict={conflict}
        name={name}
        onApply={onMerged}
        onCancel={() => setShowDiff(false)}
      />
    )
  }

  return (
    <div className="file-conflict__backdrop" role="presentation">
      <div
        className="file-conflict__dialog"
        role="dialog"
        aria-modal="true"
        aria-label="파일 캐시 충돌"
      >
        <div className="file-conflict__title">파일 캐시 충돌</div>
        <div className="file-conflict__body">
          <p>
            <code>{name}</code> 파일이 외부에서 변경되었는데, 편집기에도 저장되지
            않은 변경 사항이 있습니다.
          </p>
          <p>어느 쪽 버전을 유지하시겠습니까?</p>
        </div>
        <div className="file-conflict__actions">
          <button type="button" onClick={onLoadDisk}>
            파일 시스템 변경 불러오기
          </button>
          <button type="button" onClick={onKeepMemory}>
            메모리 변경 유지
          </button>
          <button type="button" onClick={() => setShowDiff(true)}>
            차이 보기…
          </button>
          <button
            type="button"
            className="file-conflict__dismiss"
            onClick={onDismiss}
            aria-label="닫기"
          >
            취소
          </button>
        </div>
      </div>
    </div>
  )
}

interface DiffProps {
  conflict: FileConflict
  name: string
  onApply: (merged: string) => void
  onCancel: () => void
}

function ConflictDiff({ conflict, name, onApply, onCancel }: DiffProps) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const modifiedRef = useRef<monaco.editor.ITextModel | null>(null)

  useEffect(() => {
    setupMonaco()
    const el = containerRef.current
    if (!el) return
    const lang = toMonacoLanguage(conflict.language)
    // Standalone URIs so these scratch models never collide with the real
    // file's model in the global registry.
    const original = monaco.editor.createModel(
      conflict.diskContent,
      lang,
      monaco.Uri.parse('inmemory:///conflict-disk'),
    )
    const modified = monaco.editor.createModel(
      conflict.memoryContent,
      lang,
      monaco.Uri.parse('inmemory:///conflict-memory'),
    )
    modifiedRef.current = modified

    const diff = monaco.editor.createDiffEditor(el, {
      theme: EDITOR_THEME,
      automaticLayout: true,
      fontFamily: EDITOR_FONT_FAMILY,
      fontSize: 13,
      originalEditable: false,
      readOnly: false,
      renderSideBySide: true,
    })
    diff.setModel({ original, modified })

    return () => {
      diff.dispose()
      original.dispose()
      modified.dispose()
      modifiedRef.current = null
    }
  }, [conflict])

  return (
    <div className="file-conflict__backdrop" role="presentation">
      <div className="file-conflict__diff" role="dialog" aria-modal="true">
        <div className="file-conflict__diff-head">
          <span>{name} (파일 시스템)</span>
          <span>{name} (메모리)</span>
        </div>
        <div ref={containerRef} className="file-conflict__diff-body" />
        <div className="file-conflict__actions">
          <button
            type="button"
            onClick={() => onApply(modifiedRef.current?.getValue() ?? conflict.memoryContent)}
          >
            오른쪽(메모리) 내용으로 저장
          </button>
          <button
            type="button"
            className="file-conflict__dismiss"
            onClick={onCancel}
          >
            뒤로
          </button>
        </div>
      </div>
    </div>
  )
}
