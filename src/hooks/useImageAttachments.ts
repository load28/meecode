import { useCallback, useRef, useState } from 'react'

export interface PendingImage {
  id: string
  mediaType: string
  data: string
  previewUrl: string
}

async function ingestImageFile(file: File): Promise<PendingImage | null> {
  if (!file.type.startsWith('image/')) return null
  const buf = await file.arrayBuffer()
  const bytes = new Uint8Array(buf)
  let binary = ''
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i])
  }
  const base64 = btoa(binary)
  return {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    mediaType: file.type,
    data: base64,
    previewUrl: `data:${file.type};base64,${base64}`,
  }
}

export interface UseImageAttachmentsResult {
  pendingImages: PendingImage[]
  fileInputRef: React.RefObject<HTMLInputElement>
  openFilePicker: () => void
  removeImage: (id: string) => void
  clear: () => void
  onPaste: (e: React.ClipboardEvent<HTMLTextAreaElement>) => Promise<void>
  onDrop: (e: React.DragEvent<HTMLTextAreaElement>) => Promise<void>
  onFileInputChange: (e: React.ChangeEvent<HTMLInputElement>) => Promise<void>
}

/**
 * Manage the composer's image attachment buffer.
 *
 * Owns the pending list, the hidden `<input type=file>` ref, and the
 * three intake paths (paste, drag-drop, file dialog). Each intake
 * gathers every image-like file from the event, base64-encodes it via
 * `ingestImageFile`, and appends to the buffer. Non-image entries are
 * silently skipped, which matches the previous inline behavior.
 */
export function useImageAttachments(): UseImageAttachmentsResult {
  const [pendingImages, setPendingImages] = useState<PendingImage[]>([])
  const fileInputRef = useRef<HTMLInputElement | null>(null)

  const append = useCallback((img: PendingImage) => {
    setPendingImages((prev) => [...prev, img])
  }, [])

  const onPaste = useCallback(
    async (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
      const items = Array.from(e.clipboardData?.items ?? [])
      const images = items.filter(
        (i) => i.kind === 'file' && i.type.startsWith('image/'),
      )
      if (images.length === 0) return
      e.preventDefault()
      for (const item of images) {
        const file = item.getAsFile()
        if (!file) continue
        const img = await ingestImageFile(file)
        if (img) append(img)
      }
    },
    [append],
  )

  const onDrop = useCallback(
    async (e: React.DragEvent<HTMLTextAreaElement>) => {
      const files = Array.from(e.dataTransfer.files ?? [])
      const images = files.filter((f) => f.type.startsWith('image/'))
      if (images.length === 0) return
      e.preventDefault()
      for (const f of images) {
        const img = await ingestImageFile(f)
        if (img) append(img)
      }
    },
    [append],
  )

  const onFileInputChange = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = Array.from(e.target.files ?? [])
      for (const f of files) {
        const img = await ingestImageFile(f)
        if (img) append(img)
      }
      e.target.value = ''
    },
    [append],
  )

  const removeImage = useCallback((id: string) => {
    setPendingImages((prev) => prev.filter((p) => p.id !== id))
  }, [])

  const openFilePicker = useCallback(() => {
    fileInputRef.current?.click()
  }, [])

  const clear = useCallback(() => setPendingImages([]), [])

  return {
    pendingImages,
    fileInputRef,
    openFilePicker,
    removeImage,
    clear,
    onPaste,
    onDrop,
    onFileInputChange,
  }
}
