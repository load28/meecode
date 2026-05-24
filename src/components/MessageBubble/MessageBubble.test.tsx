import { fireEvent, render, screen } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import { renderMarkdown, SegmentView } from './index'
import type { AssistantSegment } from '../../types'

describe('renderMarkdown', () => {
  it('마크다운을 안전한 HTML로 변환', () => {
    const html = renderMarkdown('# Title\n\n**bold**')
    expect(html).toContain('<h1>Title</h1>')
    expect(html).toContain('<strong>bold</strong>')
  })

  it('XSS 스크립트를 sanitize', () => {
    const html = renderMarkdown('<script>alert(1)</script>')
    expect(html).not.toContain('<script>')
  })

  it('코드 블록을 파싱 시점에 하이라이트 — 스트리밍 중 흰 코드가 먼저 그려지지 않게', () => {
    const html = renderMarkdown('```ts\nconst x = 1\n```')
    expect(html).toContain('class="language-typescript"')
    // Prism 토큰 span이 HTML 문자열 자체에 들어 있어야 한다(렌더 후 useEffect가
    // 아니라). 이게 깜빡임을 없애는 핵심.
    expect(html).toContain('token keyword')
  })

  it('알 수 없는 언어는 이스케이프된 평문으로 — 토큰 span 없이', () => {
    const html = renderMarkdown('```nope\na < b\n```')
    expect(html).toContain('a &lt; b')
    expect(html).not.toContain('token')
  })

  it('모든 코드 블록에 복사 버튼 마크업을 심는다', () => {
    const html = renderMarkdown('```\nplain\n```')
    expect(html).toContain('markdown-copy-btn')
  })
})

describe('SegmentView', () => {
  it('text 세그먼트를 마크다운으로 렌더', () => {
    const seg: AssistantSegment = { kind: 'text', text: '# Hello' }
    render(<SegmentView segment={seg} />)
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Hello')
  })

  it('plan 세그먼트를 라벨과 함께 렌더', () => {
    const seg: AssistantSegment = { kind: 'plan', text: '# Plan body' }
    const { container } = render(<SegmentView segment={seg} />)
    expect(screen.getByText('📋 Plan')).toBeInTheDocument()
    expect(container.querySelector('.message-bubble__plan')).toBeInTheDocument()
  })

  it('커서 밑 코드 블록에만 hover 클래스를 단다 — 블록 단위 복사 버튼', () => {
    const seg: AssistantSegment = { kind: 'text', text: '```ts\nconst x = 1\n```' }
    const { container } = render(<SegmentView segment={seg} />)
    const root = container.querySelector('.message-bubble__content') as HTMLElement
    const pre = container.querySelector('pre') as HTMLElement
    // jsdom엔 레이아웃이 없어 elementFromPoint 자체가 없다 — 커서 밑 요소를 흉내낸다.
    const original = document.elementFromPoint
    document.elementFromPoint = (() => pre) as typeof document.elementFromPoint
    try {
      fireEvent.pointerMove(root, { clientX: 5, clientY: 5 })
      expect(pre).toHaveClass('markdown-pre--hover')
      fireEvent.pointerLeave(root)
      expect(pre).not.toHaveClass('markdown-pre--hover')
    } finally {
      document.elementFromPoint = original
    }
  })

  it('tool_use(Bash) 세그먼트를 ToolView로 렌더 — 이름과 command 노출', () => {
    const seg: AssistantSegment = {
      kind: 'tool_use',
      id: '',
      name: 'Bash',
      summary: 'ls -la',
      input: { command: 'ls -la' },
    }
    const { container } = render(<SegmentView segment={seg} />)
    expect(container.textContent).toContain('Bash')
    expect(container.textContent).toContain('ls -la')
  })
})
