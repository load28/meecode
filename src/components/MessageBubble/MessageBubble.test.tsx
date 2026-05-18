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
    expect(screen.getByText('📋 Plan')).toBeInTheDocument()
    expect(container.querySelector('.message-bubble__plan')).toBeInTheDocument()
  })

  it('tool_use 세그먼트를 details로 렌더 (기본 닫힘)', () => {
    const seg: AssistantSegment = { kind: 'tool_use', name: 'Bash', summary: 'ls -la' }
    const { container } = render(<SegmentView segment={seg} />)
    const det = container.querySelector('.message-bubble__tool') as HTMLDetailsElement
    expect(det).not.toBeNull()
    expect(det.open).toBe(false)
    expect(det.textContent).toContain('Bash')
    expect(det.textContent).toContain('ls -la')
  })
})
