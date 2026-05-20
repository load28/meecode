import { render, screen } from '@testing-library/react'
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
    expect(screen.getByText('Plan')).toBeInTheDocument()
    expect(container.querySelector('.message-bubble__plan')).toBeInTheDocument()
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
