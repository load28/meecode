import { useEffect, useState } from 'react'

interface Options {
  taskId: string
  name: string
  readFile: (name: string) => Promise<string>
  writeFile: (name: string, content: string) => Promise<boolean>
  deleteFile: (name: string) => Promise<void>
  onDeleted: () => void
}

export type WikiMode = 'read' | 'edit'

export interface UseWikiBufferResult {
  mode: WikiMode
  setMode: (next: WikiMode) => void
  original: string
  draft: string
  setDraft: (next: string) => void
  loading: boolean
  saving: boolean
  dirty: boolean
  hasContent: boolean
  /** dirty 상태에서 닫기 시도 시 확인 후 onClose에 위임할지 결정. */
  confirmCloseIfDirty: (onConfirmed: () => void) => void
  save: () => Promise<void>
  revert: () => void
  /** confirm 후 deleteFile 실행, 성공 시 onDeleted 호출. */
  remove: () => Promise<void>
}

/**
 * 한 위키 파일의 buffer 상태(read/edit 모드, original vs draft, dirty 추적,
 * save/revert/delete 액션)를 묶은 훅. taskId/name이 바뀌면 새 파일을 다시
 * 불러온다.
 */
export function useWikiBuffer({
  taskId,
  name,
  readFile,
  writeFile,
  deleteFile,
  onDeleted,
}: Options): UseWikiBufferResult {
  const [mode, setMode] = useState<WikiMode>('read')
  const [original, setOriginal] = useState('')
  const [draft, setDraft] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    void readFile(name).then((body) => {
      if (cancelled) return
      setOriginal(body)
      setDraft(body)
      setLoading(false)
    })
    return () => {
      cancelled = true
    }
  }, [taskId, name, readFile])

  const dirty = draft !== original
  const hasContent = draft.trim().length > 0 || original.trim().length > 0

  const save = async () => {
    setSaving(true)
    try {
      const ok = await writeFile(name, draft)
      if (ok) {
        setOriginal(draft)
        setMode('read')
      }
    } finally {
      setSaving(false)
    }
  }

  const revert = () => {
    setDraft(original)
    setMode('read')
  }

  const remove = async () => {
    if (!confirm(`위키 파일 "${name}"을(를) 삭제하시겠습니까?`)) return
    await deleteFile(name)
    onDeleted()
  }

  const confirmCloseIfDirty = (onConfirmed: () => void) => {
    if (
      dirty &&
      !confirm('저장하지 않은 변경 사항이 있습니다. 닫으시겠습니까?')
    ) {
      return
    }
    onConfirmed()
  }

  return {
    mode,
    setMode,
    original,
    draft,
    setDraft,
    loading,
    saving,
    dirty,
    hasContent,
    confirmCloseIfDirty,
    save,
    revert,
    remove,
  }
}
