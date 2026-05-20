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

  it('pair 본문에 질문 영역 + 답변 segments 풀 렌더', () => {
    const long = 'a'.repeat(600)
    const longQuestion = '스킬 컨텐츠'.repeat(50)
    render(<ExpandPane pair={pair('a', longQuestion, [text(long)])} isOpen={true} onToggle={() => {}} />)
    expect(screen.getByText('질문')).toBeInTheDocument()
    expect(screen.getByText(longQuestion)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /전체보기/ })).toBeNull()
  })

  it('segments가 비어 있어도 질문은 풀로 표시', () => {
    render(<ExpandPane pair={pair('a', '스킬을 호출했어요', [])} isOpen={true} onToggle={() => {}} />)
    expect(screen.getByText('스킬을 호출했어요')).toBeInTheDocument()
    expect(screen.getByText('답변 대기 중…')).toBeInTheDocument()
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

  it('thinking·tool·text가 컴팩트 step + 풀 markdown 답변으로 렌더 (QaCard와 동일 패턴, 텍스트만 풀)', () => {
    const segs: AssistantSegment[] = [
      { kind: 'thinking', text: '본문 무시됨', partial: false, duration_ms: 6_000 },
      {
        kind: 'tool_use',
        id: 'tu-1',
        name: 'Bash',
        summary: 'ls',
        input: { command: 'ls' },
      },
      {
        kind: 'tool_result',
        tool_use_id: 'tu-1',
        text: 'file.txt',
        is_error: false,
      },
      { kind: 'text', text: '최종 답변입니다.' },
    ]
    const { container } = render(
      <ExpandPane
        pair={pair('a', '질문', segs)}
        isOpen={true}
        onToggle={() => {}}
      />,
    )
    // thinking은 한 줄 step ("Thought for Ns"), 본문 텍스트는 무시
    expect(screen.getByText(/Thought for 6s/)).toBeInTheDocument()
    expect(screen.queryByText('본문 무시됨')).toBeNull()
    // tool_use는 step + 도구명
    expect(screen.getByText('Bash')).toBeInTheDocument()
    expect(screen.getByText('ls')).toBeInTheDocument()
    // tool_result는 인라인 숨김
    expect(screen.queryByText('file.txt')).toBeNull()
    expect(screen.queryByText('도구 결과')).toBeNull()
    // 최종 markdown 답변은 풀로 렌더 (preview truncation 없음)
    const body = container.querySelector('.expand-pane__body') as HTMLElement
    expect(body).toBeTruthy()
    expect(body.textContent).toContain('최종 답변입니다.')
  })

  it('file_path 도구는 클릭 가능한 링크로 렌더 — onOpenFile 호출', () => {
    const onOpenFile = vi.fn()
    const segs: AssistantSegment[] = [
      {
        kind: 'tool_use',
        id: 'tu-r',
        name: 'Read',
        summary: '/abs/path/file.tsx',
        input: { file_path: '/abs/path/file.tsx' },
      },
    ]
    render(
      <ExpandPane
        pair={pair('a', '질문', segs)}
        isOpen={true}
        onToggle={() => {}}
        onOpenFile={onOpenFile}
      />,
    )
    const link = screen.getByRole('button', { name: /\/abs\/path\/file\.tsx/ })
    fireEvent.click(link)
    expect(onOpenFile).toHaveBeenCalledWith('/abs/path/file.tsx')
  })
})
