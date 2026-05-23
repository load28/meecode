import { useState } from 'react'
import type { PendingImage } from './useImageAttachments'

interface Options {
  value: string
  setValue: (next: string) => void
  /** 전송 직전에 placeholder를 fenced code block으로 풀어준다. */
  expandSelections: (text: string) => string
  pendingImages: PendingImage[]
  sendUserMessage: (
    text: string,
    images?: Array<{ media_type: string; data: string }>,
  ) => Promise<void>
  /** 전송 성공 시 정리할 보조 상태들. */
  onAfterSubmit: () => void
}

export interface UseComposerSubmitResult {
  error: string | null
  /**
   * Empty submit + 이미지도 없으면 no-op. 그 외엔 selection 토큰 expand →
   * trimEnd → sendUserMessage. 실패 시 error에 메시지를 적는다.
   */
  submit: () => Promise<void>
}

/**
 * composer의 'value + 이미지를 백엔드로 전송하고 입력란/메뉴/히스토리/
 * selection 토큰을 정리'하는 흐름을 한 훅으로 묶음.
 *
 * 컴포저 onSubmit이 손대는 외부 효과가 많아 props 묶음은 큰 편이지만,
 * '한 turn의 message-send 사이클'이라는 한 가지 의미를 갖는 동작이라
 * 한 곳에 모이는 게 자연스럽다.
 */
export function useComposerSubmit({
  value,
  setValue,
  expandSelections,
  pendingImages,
  sendUserMessage,
  onAfterSubmit,
}: Options): UseComposerSubmitResult {
  const [error, setError] = useState<string | null>(null)

  const submit = async () => {
    // CLI parity: trailing whitespace 제거 후 빈 입력 + 이미지 없음은 no-op.
    // selection placeholder는 전송 직전 fenced code block으로 expand.
    const expanded = expandSelections(value)
    const trimmed = expanded.trimEnd()
    if (!trimmed && pendingImages.length === 0) return
    const images = pendingImages.map((p) => ({
      media_type: p.mediaType,
      data: p.data,
    }))
    setError(null)
    try {
      await sendUserMessage(trimmed, images.length > 0 ? images : undefined)
      setValue('')
      onAfterSubmit()
    } catch (e) {
      setError(String(e))
    }
  }

  return { error, submit }
}
