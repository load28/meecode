import { useCallback, useState } from 'react'
import type { CaptureDraft } from '../components/TaskPicker'
import type { CaptureSource } from '../types/composer'

interface Options {
  sessionId: string | null
  projectPath: string
}

export interface UseCapturePickerResult {
  /** 캡처 다이얼로그(TaskPicker)에 넘길 draft. null이면 다이얼로그 숨김. */
  draft: CaptureDraft | null
  /** QaCard/CommentFloat의 '📥' 버튼이 클릭됐을 때 부르는 핸들러. */
  open: (source: CaptureSource) => void
  /** TaskPicker가 닫힐 때 호출 — draft를 비운다. */
  close: () => void
}

/**
 * Task 캡처 흐름의 작은 상태 머신.
 *
 * QaCard나 CommentFloat에서 캡처 버튼이 눌리면 `open(source)`로 draft를
 * 채우고, MainLayout이 그 시점에 TaskPicker 다이얼로그를 마운트한다.
 * draft에는 현재 세션/프로젝트 컨텍스트가 함께 묶여 들어가 picker에서
 * Source 생성 시 origin을 보존할 수 있게 한다.
 */
export function useCapturePicker({
  sessionId,
  projectPath,
}: Options): UseCapturePickerResult {
  const [draft, setDraft] = useState<CaptureDraft | null>(null)

  const open = useCallback(
    (source: CaptureSource) => {
      setDraft({
        kind: source.kind,
        content: source.content,
        suggestedTitle: source.suggestedTitle,
        sessionId: sessionId ?? null,
        qaId: source.qaId,
        projectPath,
      })
    },
    [sessionId, projectPath],
  )

  const close = useCallback(() => setDraft(null), [])

  return { draft, open, close }
}
