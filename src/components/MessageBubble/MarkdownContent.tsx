import { useEffect, useRef } from 'react'
import { marked } from 'marked'
import DOMPurify from 'dompurify'

export function renderMarkdown(src: string): string {
  const raw = marked.parse(src, { async: false }) as string
  return DOMPurify.sanitize(raw)
}

interface Props {
  source: string
  className?: string
}

export function MarkdownContent({ source, className }: Props) {
  const ref = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    const root = ref.current
    if (!root) return
    const pres = root.querySelectorAll('pre')
    const cleanups: Array<() => void> = []
    pres.forEach((pre) => {
      if (pre.querySelector('.markdown-copy-btn')) return
      const btn = document.createElement('button')
      btn.type = 'button'
      btn.className = 'markdown-copy-btn'
      btn.title = '복사'
      btn.textContent = '⧉'
      const onClick = async () => {
        const code = pre.querySelector('code')
        const text = code ? code.textContent : pre.textContent
        if (!text) return
        try {
          await navigator.clipboard.writeText(text)
          btn.textContent = '✓'
          setTimeout(() => {
            btn.textContent = '⧉'
          }, 1200)
        } catch {
          btn.textContent = '✗'
        }
      }
      btn.addEventListener('click', onClick)
      pre.style.position = pre.style.position || 'relative'
      pre.appendChild(btn)
      cleanups.push(() => {
        btn.removeEventListener('click', onClick)
        btn.remove()
      })
    })
    return () => {
      cleanups.forEach((fn) => fn())
    }
  }, [source])

  return (
    <div
      ref={ref}
      className={className}
      dangerouslySetInnerHTML={{ __html: renderMarkdown(source) }}
    />
  )
}
