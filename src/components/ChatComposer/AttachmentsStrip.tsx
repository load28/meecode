import type { PendingImage } from '../../hooks/useImageAttachments'

interface Props {
  images: PendingImage[]
  onRemove: (id: string) => void
}

/** Horizontal preview row for the composer's pending image attachments. */
export function AttachmentsStrip({ images, onRemove }: Props) {
  if (images.length === 0) return null
  return (
    <div className="chat-composer__attachments">
      {images.map((img) => (
        <div key={img.id} className="chat-composer__attachment">
          <img src={img.previewUrl} alt="첨부 이미지" />
          <button
            type="button"
            className="chat-composer__attachment-remove"
            onClick={() => onRemove(img.id)}
            aria-label="이미지 제거"
            title="제거"
          >
            ×
          </button>
        </div>
      ))}
    </div>
  )
}
