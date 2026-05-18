import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import { QaCard } from './index'
import type { AssistantSegment, QaPair } from '../../types'

const text = (s: string): AssistantSegment => ({ kind: 'text', text: s })
const tool = (name: string, summary = ''): AssistantSegment => ({
  kind: 'tool_use', name, summary,
})

const pair = (id: string, segs: AssistantSegment[]): QaPair => ({
  id, user_text: '내 질문', segments: segs, timestamp: '2026-05-18T00:00:00Z',
})

const LONG = 'a'.repeat(600)

describe('QaCard', () => {
  it('짧은 답변은 전체 텍스트를 인라인 렌더', () => {
    const p = pair('a', [text('hello')])
    render(<QaCard pair={p} isExpandedInPane={false} onExpand={() => {}} />)
    expect(screen.getByText('hello')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /전체보기/ })).toBeNull()
  })

  it('질문 텍스트를 표시', () => {
    render(<QaCard pair={pair('a', [text('r')])} isExpandedInPane={false} onExpand={() => {}} />)
    expect(screen.getByText('내 질문')).toBeInTheDocument()
  })

  it('500자 초과 답변은 미리보기 + 전체보기 버튼', () => {
    render(
      <QaCard pair={pair('a', [text(LONG)])} isExpandedInPane={false} onExpand={() => {}} />
    )
    expect(screen.getByRole('button', { name: '답변 전체보기' })).toBeInTheDocument()
  })

  it('전체보기 버튼 클릭 시 onExpand 호출', () => {
    const onExpand = vi.fn()
    render(
      <QaCard pair={pair('a', [text(LONG)])} isExpandedInPane={false} onExpand={onExpand} />
    )
    fireEvent.click(screen.getByRole('button', { name: '답변 전체보기' }))
    expect(onExpand).toHaveBeenCalledTimes(1)
  })

  it('isExpandedInPane=true면 본문 자리에 안내 메시지', () => {
    const { container } = render(
      <QaCard pair={pair('a', [text(LONG)])} isExpandedInPane={true} onExpand={() => {}} />
    )
    expect(screen.getByText('오른쪽 패널에 펼쳐짐')).toBeInTheDocument()
    expect(container.querySelector('.qa-card__preview')).toBeNull()
  })

  it('segments가 비어 있으면 응답 대기 placeholder', () => {
    render(<QaCard pair={pair('a', [])} isExpandedInPane={false} onExpand={() => {}} />)
    expect(screen.getByText('응답 대기 중…')).toBeInTheDocument()
  })

  it('tool_use는 폴드 무관 항상 inline', () => {
    const p = pair('a', [text(LONG), tool('Bash', 'ls')])
    render(<QaCard pair={p} isExpandedInPane={false} onExpand={() => {}} />)
    expect(screen.getByText('Bash')).toBeInTheDocument()
  })
})
