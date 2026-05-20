import { useEffect, useRef } from 'react'
import { marked } from 'marked'
import DOMPurify from 'dompurify'
import Prism from 'prismjs'
// Prism components depend on a strict import order. JS is built-in,
// markup needs to land before tsx, and typescript before tsx.
import 'prismjs/components/prism-markup'
import 'prismjs/components/prism-typescript'
import 'prismjs/components/prism-jsx'
import 'prismjs/components/prism-tsx'
import 'prismjs/components/prism-bash'
import 'prismjs/components/prism-json'
import 'prismjs/components/prism-python'
import 'prismjs/components/prism-rust'
import 'prismjs/components/prism-go'
import 'prismjs/components/prism-yaml'
import 'prismjs/components/prism-css'
import 'prismjs/components/prism-sql'
import './prism-tokens.css'

const LANG_ALIAS: Record<string, string> = {
  ts: 'typescript',
  tsx: 'tsx',
  js: 'javascript',
  jsx: 'jsx',
  py: 'python',
  sh: 'bash',
  shell: 'bash',
  yml: 'yaml',
  md: 'markdown',
  rs: 'rust',
}

// Match the VS Code Claude Code extension defaults: GitHub-flavored markdown
// with hard line breaks honored, no pedantic mode. Setting these explicitly
// guards against marked version drift changing defaults underneath us.
marked.use({
  gfm: true,
  breaks: true,
  pedantic: false,
})

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
    const codes = root.querySelectorAll('pre code')
    codes.forEach((codeEl) => {
      const cls = (codeEl as HTMLElement).className || ''
      const m = cls.match(/language-([\w+-]+)/)
      const lang = m ? LANG_ALIAS[m[1]] ?? m[1] : ''
      if (lang && Prism.languages[lang]) {
        try {
          const html = Prism.highlight(
            codeEl.textContent ?? '',
            Prism.languages[lang],
            lang,
          )
          codeEl.innerHTML = html
        } catch {
          // ignore highlight errors, fall back to raw text
        }
      }
    })
    const pres = root.querySelectorAll('pre')
    const cleanups: Array<() => void> = []
    const COPY_SVG =
      '<svg class="icon" viewBox="0 0 16 16" width="14" height="14" fill="currentColor" aria-hidden="true"><path d="M0 6.75C0 5.784.784 5 1.75 5h1.5a.75.75 0 0 1 0 1.5h-1.5a.25.25 0 0 0-.25.25v7.5c0 .138.112.25.25.25h7.5a.25.25 0 0 0 .25-.25v-1.5a.75.75 0 0 1 1.5 0v1.5A1.75 1.75 0 0 1 9.25 16h-7.5A1.75 1.75 0 0 1 0 14.25Z"/><path d="M5 1.75C5 .784 5.784 0 6.75 0h7.5C15.216 0 16 .784 16 1.75v7.5A1.75 1.75 0 0 1 14.25 11h-7.5A1.75 1.75 0 0 1 5 9.25Zm1.75-.25a.25.25 0 0 0-.25.25v7.5c0 .138.112.25.25.25h7.5a.25.25 0 0 0 .25-.25v-7.5a.25.25 0 0 0-.25-.25Z"/></svg>'
    const CHECK_SVG =
      '<svg class="icon" viewBox="0 0 16 16" width="14" height="14" fill="currentColor" aria-hidden="true"><path d="M13.78 4.22a.75.75 0 0 1 0 1.06l-7.25 7.25a.75.75 0 0 1-1.06 0L2.22 9.28a.751.751 0 0 1 .018-1.042.751.751 0 0 1 1.042-.018L6 10.94l6.72-6.72a.75.75 0 0 1 1.06 0Z"/></svg>'
    const FAIL_SVG =
      '<svg class="icon" viewBox="0 0 16 16" width="14" height="14" fill="currentColor" aria-hidden="true"><path d="M3.72 3.72a.75.75 0 0 1 1.06 0L8 6.94l3.22-3.22a.749.749 0 0 1 1.275.326.749.749 0 0 1-.215.734L9.06 8l3.22 3.22a.749.749 0 0 1-.326 1.275.749.749 0 0 1-.734-.215L8 9.06l-3.22 3.22a.751.751 0 0 1-1.042-.018.751.751 0 0 1-.018-1.042L6.94 8 3.72 4.78a.75.75 0 0 1 0-1.06Z"/></svg>'
    pres.forEach((pre) => {
      if (pre.querySelector('.markdown-copy-btn')) return
      const btn = document.createElement('button')
      btn.type = 'button'
      btn.className = 'markdown-copy-btn'
      btn.title = '복사'
      btn.innerHTML = COPY_SVG
      const onClick = async () => {
        const code = pre.querySelector('code')
        const text = code ? code.textContent : pre.textContent
        if (!text) return
        try {
          await navigator.clipboard.writeText(text)
          btn.innerHTML = CHECK_SVG
          setTimeout(() => {
            btn.innerHTML = COPY_SVG
          }, 1200)
        } catch {
          btn.innerHTML = FAIL_SVG
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
