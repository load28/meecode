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
    pres.forEach((pre) => {
      if (pre.querySelector('.markdown-copy-btn')) return
      const btn = document.createElement('button')
      btn.type = 'button'
      btn.className = 'markdown-copy-btn'
      btn.title = '복사'
      btn.textContent = '📋'
      const onClick = async () => {
        const code = pre.querySelector('code')
        const text = code ? code.textContent : pre.textContent
        if (!text) return
        try {
          await navigator.clipboard.writeText(text)
          btn.textContent = '✓'
          setTimeout(() => {
            btn.textContent = '📋'
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
