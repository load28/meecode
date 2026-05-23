import { useEffect, useMemo, useRef } from 'react'
import { marked, type Tokens } from 'marked'
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

/** "복사됨" 체크마크가 다시 📋로 돌아가기까지 걸리는 시간. */
const COPY_FEEDBACK_MS = 1200

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

// 모든 코드 블록에 같은 마크업으로 심어두고 컨테이너 한 곳에서 클릭을
// 위임받는다 — 렌더할 때마다 버튼을 DOM에 새로 꽂지 않게 한다.
const COPY_BTN_HTML =
  '<button type="button" class="markdown-copy-btn" title="복사">📋</button>'

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

// Match the VS Code Claude Code extension defaults: GitHub-flavored markdown
// with hard line breaks honored, no pedantic mode. Setting these explicitly
// guards against marked version drift changing defaults underneath us.
//
// 코드 블록은 파싱 시점에 Prism으로 하이라이트해 둔다. 스트리밍 중 source는
// 프레임마다 바뀌는데, 예전엔 paint 뒤 useEffect가 다시 칠하느라 매 프레임
// "흰 코드 → 색칠" 한 단계가 끼어 깜빡였다. HTML을 처음부터 색칠된 채
// 내보내면 그 중간 상태가 사라진다.
marked.use({
  gfm: true,
  breaks: true,
  pedantic: false,
  renderer: {
    code({ text, lang }: Tokens.Code): string {
      const info = (lang ?? '').match(/^\S*/)?.[0] ?? ''
      const language = info ? LANG_ALIAS[info] ?? info : ''
      const grammar = language ? Prism.languages[language] : undefined
      // 기본 렌더러와 동일하게 끝 개행을 정규화해 코드 블록 하단 여백을 맞춘다.
      const code = text.replace(/\n$/, '') + '\n'
      const body = grammar
        ? Prism.highlight(code, grammar, language)
        : escapeHtml(code)
      const classAttr = language
        ? ` class="language-${escapeHtml(language)}"`
        : ''
      return `<pre><code${classAttr}>${body}</code>${COPY_BTN_HTML}</pre>`
    },
  },
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
  // source는 스트리밍 중 프레임마다 바뀌지만 다른 이유로 리렌더될 때는
  // 파싱·하이라이트를 다시 돌리지 않도록 source 기준으로만 메모한다.
  const html = useMemo(() => renderMarkdown(source), [source])

  // 복사 버튼 마크업은 renderMarkdown이 HTML에 직접 심으므로, 매 렌더마다
  // 버튼을 만들고 지우는 대신 컨테이너에 위임 리스너 하나만 붙인다.
  useEffect(() => {
    const root = ref.current
    if (!root) return
    const onClick = (e: MouseEvent) => {
      const btn = (e.target as HTMLElement).closest('.markdown-copy-btn')
      if (!(btn instanceof HTMLElement)) return
      const code = btn.closest('pre')?.querySelector('code')
      const text = code?.textContent
      if (!text) return
      navigator.clipboard.writeText(text).then(
        () => {
          btn.textContent = '✓'
          setTimeout(() => {
            btn.textContent = '📋'
          }, COPY_FEEDBACK_MS)
        },
        () => {
          btn.textContent = '✗'
        },
      )
    }
    root.addEventListener('click', onClick)
    return () => root.removeEventListener('click', onClick)
  }, [])

  return (
    <div
      ref={ref}
      className={className}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  )
}
