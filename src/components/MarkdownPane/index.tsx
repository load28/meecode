import { useMemo } from 'react'
import { marked } from 'marked'
import DOMPurify from 'dompurify'
import { useSelection } from '../../hooks/useSelection'
import { CommentFloat } from '../CommentFloat'
import './MarkdownPane.css'

interface Props {
  content: string
  isVisible: boolean
}

export function MarkdownPane({ content, isVisible }: Props) {
  const { selection, handleMouseUp, clearSelection } = useSelection()

  const html = useMemo(() => {
    if (!content) return ''
    const raw = marked.parse(content, { async: false }) as string
    return DOMPurify.sanitize(raw)
  }, [content])

  return (
    <div
      className="markdown-pane"
      style={{ display: isVisible ? 'flex' : 'none' }}
      onMouseUp={handleMouseUp}
    >
      <div
        className="markdown-pane__content"
        dangerouslySetInnerHTML={{ __html: html }}
      />
      {selection.text && selection.rect && (
        <CommentFloat
          selection={{ text: selection.text, rect: selection.rect }}
          onClose={clearSelection}
        />
      )}
    </div>
  )
}
