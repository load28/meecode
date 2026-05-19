import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import { QaCard } from './index'
import type { AssistantSegment, QaPair } from '../../types'

const text = (s: string): AssistantSegment => ({ kind: 'text', text: s })
const tool = (name: string, summary = '', id = ''): AssistantSegment => ({
  kind: 'tool_use', id, name, summary, input: null,
})

const pair = (id: string, segs: AssistantSegment[]): QaPair => ({
  id, user_text: '내 질문', segments: segs, timestamp: '2026-05-18T00:00:00Z',
})

const LONG = 'a'.repeat(600)

describe('QaCard', () => {
  it('답변 본문 미리보기를 렌더', () => {
    const p = pair('a', [text('hello')])
    render(<QaCard pair={p} onExpand={() => {}} />)
    expect(screen.getByText('hello')).toBeInTheDocument()
  })

  it('질문 텍스트를 표시', () => {
    render(<QaCard pair={pair('a', [text('r')])} onExpand={() => {}} />)
    expect(screen.getByText('내 질문')).toBeInTheDocument()
  })

  it('답변 유무와 무관하게 전체보기 버튼 항상 노출', () => {
    const { rerender } = render(<QaCard pair={pair('short', [text('짧음')])} onExpand={() => {}} />)
    expect(screen.getByRole('button', { name: '대화 전체보기' })).toBeInTheDocument()

    rerender(<QaCard pair={pair('long', [text(LONG)])} onExpand={() => {}} />)
    expect(screen.getByRole('button', { name: '대화 전체보기' })).toBeInTheDocument()

    rerender(<QaCard pair={pair('empty', [])} onExpand={() => {}} />)
    expect(screen.getByRole('button', { name: '대화 전체보기' })).toBeInTheDocument()
  })

  it('전체보기 버튼 클릭 시 onExpand 호출', () => {
    const onExpand = vi.fn()
    render(<QaCard pair={pair('a', [text(LONG)])} onExpand={onExpand} />)
    fireEvent.click(screen.getByRole('button', { name: '대화 전체보기' }))
    expect(onExpand).toHaveBeenCalledTimes(1)
  })

  it('segments가 비어 있으면 응답 대기 placeholder', () => {
    render(<QaCard pair={pair('a', [])} onExpand={() => {}} />)
    expect(screen.getByText('응답 대기 중…')).toBeInTheDocument()
  })

  it('thinking은 한 줄 step으로 노출 (본문은 카드에 안 나옴 — ExpandPane에서만)', () => {
    const p = pair('a', [
      { kind: 'thinking', text: '잠깐 생각하자', partial: false, duration_ms: 2_000 },
      text('answer'),
    ])
    const { container } = render(<QaCard pair={p} onExpand={() => {}} />)
    expect(screen.getByText('Thought for 2s')).toBeInTheDocument()
    expect(screen.getByText('answer')).toBeInTheDocument()
    // thinking 본문 텍스트는 QaCard에 노출되지 않음 (compact)
    expect(screen.queryByText('잠깐 생각하자')).toBeNull()
    expect(
      container.querySelector('.message-bubble__thinking'),
    ).toBeNull()
  })

  it('tool_use는 compact step으로 도구명 + 인자 한 줄', () => {
    const p = pair('a', [tool('Bash', 'ls -la')])
    const { container } = render(<QaCard pair={p} onExpand={() => {}} />)
    expect(screen.getByText('Bash')).toBeInTheDocument()
    expect(screen.getByText('ls -la')).toBeInTheDocument()
    expect(container.querySelector('.qa-card__step')).not.toBeNull()
  })

  it('tool_result는 QaCard 인라인에서 숨김 (성공/실패 무관)', () => {
    const p = pair('a', [
      tool('Bash', 'ls', 'tu1'),
      { kind: 'tool_result', tool_use_id: 'tu1', text: 'file.txt', is_error: false },
      tool('Bash', 'oops', 'tu2'),
      { kind: 'tool_result', tool_use_id: 'tu2', text: 'cmd not found', is_error: true },
    ])
    render(<QaCard pair={p} onExpand={() => {}} />)
    expect(screen.queryByText('✓ 도구 결과')).toBeNull()
    expect(screen.queryByText('❌ 도구 실패')).toBeNull()
    expect(screen.queryByText('file.txt')).toBeNull()
    expect(screen.queryByText('cmd not found')).toBeNull()
  })

  it('file_path 도구는 클릭 가능한 링크로 렌더 — onOpenFile 호출', () => {
    const onOpenFile = vi.fn()
    const p = pair('a', [
      {
        kind: 'tool_use',
        id: 'tu-r',
        name: 'Read',
        summary: '/abs/path/file.tsx',
        input: { file_path: '/abs/path/file.tsx' },
      },
    ])
    render(<QaCard pair={p} onExpand={() => {}} onOpenFile={onOpenFile} />)
    const link = screen.getByRole('button', { name: /\/abs\/path\/file\.tsx/ })
    fireEvent.click(link)
    expect(onOpenFile).toHaveBeenCalledWith('/abs/path/file.tsx')
  })

  it('답변에서 텍스트 선택 시 코멘트 플로팅 표시', () => {
    const mockRect = {
      top: 100, left: 50, width: 80, height: 20,
      bottom: 120, right: 130, x: 50, y: 100,
      toJSON: () => ({}),
    } as DOMRect
    vi.spyOn(window, 'getSelection').mockReturnValue({
      isCollapsed: false,
      toString: () => '선택',
      getRangeAt: () => ({ getBoundingClientRect: () => mockRect }),
    } as unknown as Selection)

    const { container } = render(
      <QaCard pair={pair('a', [text('짧은 답변 텍스트')])} onExpand={() => {}} />
    )
    fireEvent.mouseUp(container.querySelector('.qa-card__answer')!)
    expect(screen.getByText('💬 코멘트')).toBeInTheDocument()
  })
})
