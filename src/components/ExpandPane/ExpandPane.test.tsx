import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import { ExpandPane } from './index'
import type { AssistantSegment, QaPair } from '../../types'

const text = (s: string): AssistantSegment => ({ kind: 'text', text: s })
const pair = (id: string, q: string, segs: AssistantSegment[]): QaPair => ({
  id, user_text: q, segments: segs, timestamp: '2026-05-18T00:00:00Z',
})

describe('ExpandPane', () => {
  it('pair=null 시 placeholder', () => {
    render(<ExpandPane pair={null} isOpen={true} onToggle={() => {}} />)
    expect(screen.getByText(/'전체보기'/)).toBeInTheDocument()
  })

  it('pair 본문 풀 렌더 (폴드 없음)', () => {
    const long = 'a'.repeat(600)
    render(<ExpandPane pair={pair('a', '질문', [text(long)])} isOpen={true} onToggle={() => {}} />)
    expect(screen.getByText('질문')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /전체보기/ })).toBeNull()
  })

  it('토글 버튼 클릭 시 onToggle 호출', () => {
    const onToggle = vi.fn()
    render(<ExpandPane pair={pair('a', 'q', [text('r')])} isOpen={true} onToggle={onToggle} />)
    fireEvent.click(screen.getByRole('button', { name: /접기|닫기/ }))
    expect(onToggle).toHaveBeenCalled()
  })

  it('isOpen=false 시 패널 본문 미렌더 (null 반환)', () => {
    const { container } = render(
      <ExpandPane pair={pair('a', 'q', [text('r')])} isOpen={false} onToggle={() => {}} />
    )
    expect(container.querySelector('.expand-pane__body')).toBeNull()
    expect(container.querySelector('.expand-pane')).toBeNull()
  })
})
