import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { MarkdownPane } from './index'
import type { AssistantSegment, QaPair } from '../../types'

const text = (s: string): AssistantSegment => ({ kind: 'text', text: s })
const plan = (s: string): AssistantSegment => ({ kind: 'plan', text: s })
const tool = (name: string, summary = ''): AssistantSegment => ({
  kind: 'tool_use',
  name,
  summary,
})

const pair = (id: string, q: string, segments: AssistantSegment[]): QaPair => ({
  id,
  user_text: q,
  segments,
  timestamp: '2026-05-18T00:00:00Z',
})

describe('MarkdownPane', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('선택된 페어의 마크다운을 HTML로 렌더링', () => {
    const pairs = [pair('a', '안녕', [text('# 안녕하세요\n\n본문 텍스트')])]
    const { container } = render(
      <MarkdownPane pairs={pairs} selectedId="a" onSelect={() => {}} isVisible={true} />
    )
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('안녕하세요')
    expect(container.querySelector('.markdown-pane__content')?.textContent).toContain('본문 텍스트')
  })

  it('선택된 페어의 질문을 표시', () => {
    const pairs = [pair('a', '내 질문', [text('답변')])]
    render(
      <MarkdownPane pairs={pairs} selectedId="a" onSelect={() => {}} isVisible={true} />
    )
    expect(screen.getByText('내 질문')).toBeInTheDocument()
  })

  it('isVisible=false 시 숨김 처리', () => {
    const pairs = [pair('a', 'q', [text('r')])]
    const { container } = render(
      <MarkdownPane pairs={pairs} selectedId="a" onSelect={() => {}} isVisible={false} />
    )
    const pane = container.querySelector('.markdown-pane')
    expect(pane).toHaveStyle('display: none')
  })

  it('선택된 항목이 없으면 placeholder 표시', () => {
    const pairs = [pair('a', 'q', [text('r')])]
    render(
      <MarkdownPane pairs={pairs} selectedId={null} onSelect={() => {}} isVisible={true} />
    )
    expect(screen.getByText('좌측에서 항목을 선택하세요')).toBeInTheDocument()
  })

  it('MessageList 항목 클릭 시 onSelect 호출', () => {
    const onSelect = vi.fn()
    const pairs = [
      pair('a', '질문1', [text('답변1')]),
      pair('b', '질문2', [text('답변2')]),
    ]
    render(
      <MarkdownPane pairs={pairs} selectedId="a" onSelect={onSelect} isVisible={true} />
    )
    fireEvent.click(screen.getByText(/질문2/))
    expect(onSelect).toHaveBeenCalledWith('b')
  })

  it('plan 세그먼트를 라벨과 함께 마크다운으로 렌더링', () => {
    const pairs = [pair('a', 'q', [plan('# 마이그레이션 플랜\n\n- 1단계\n- 2단계')])]
    const { container } = render(
      <MarkdownPane pairs={pairs} selectedId="a" onSelect={() => {}} isVisible={true} />
    )
    expect(screen.getByText('📋 Plan')).toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('마이그레이션 플랜')
    expect(container.querySelector('.markdown-pane__plan')).toBeInTheDocument()
  })

  it('tool_use 세그먼트는 접힌 details로 렌더링', () => {
    const pairs = [
      pair('a', 'q', [
        text('답변 시작'),
        tool('Bash', 'ls -la'),
        text('답변 끝'),
      ]),
    ]
    const { container } = render(
      <MarkdownPane pairs={pairs} selectedId="a" onSelect={() => {}} isVisible={true} />
    )
    const toolEl = container.querySelector('.markdown-pane__tool') as HTMLDetailsElement | null
    expect(toolEl).not.toBeNull()
    expect(toolEl!.open).toBe(false)
    expect(toolEl!.textContent).toContain('Bash')
    expect(toolEl!.textContent).toContain('ls -la')
    expect(container.textContent).toContain('답변 시작')
    expect(container.textContent).toContain('답변 끝')
  })

  it('segments가 tool_use뿐이면 텍스트 응답 대기 안내 표시', () => {
    const pairs = [pair('a', 'q', [tool('Bash', 'echo hi')])]
    render(
      <MarkdownPane pairs={pairs} selectedId="a" onSelect={() => {}} isVisible={true} />
    )
    expect(screen.getByText('텍스트 응답 대기 중…')).toBeInTheDocument()
  })

  it('segments가 비어있으면 응답 대기 표시', () => {
    const pairs = [pair('a', 'q', [])]
    render(
      <MarkdownPane pairs={pairs} selectedId="a" onSelect={() => {}} isVisible={true} />
    )
    expect(screen.getByText('응답 대기 중…')).toBeInTheDocument()
  })

  it('텍스트 선택 시 CommentFloat 표시', () => {
    const mockRect = {
      top: 100, left: 50, width: 80, height: 20,
      bottom: 120, right: 130, x: 50, y: 100,
      toJSON: () => ({}),
    } as DOMRect

    vi.spyOn(window, 'getSelection').mockReturnValue({
      isCollapsed: false,
      toString: () => '선택된 텍스트',
      getRangeAt: () => ({ getBoundingClientRect: () => mockRect }),
    } as unknown as Selection)

    const pairs = [pair('a', 'q', [text('# 제목\n\n선택된 텍스트입니다')])]
    const { container } = render(
      <MarkdownPane pairs={pairs} selectedId="a" onSelect={() => {}} isVisible={true} />
    )

    fireEvent.mouseUp(container.querySelector('.markdown-pane__body')!)

    expect(screen.getByText('💬 코멘트')).toBeInTheDocument()
  })
})
