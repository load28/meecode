import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import { ChatStream } from './index'
import type { QaPair, AssistantSegment, ToolRequest } from '../../types'

const text = (s: string): AssistantSegment => ({ kind: 'text', text: s })
const pair = (id: string, q: string, segs: AssistantSegment[]): QaPair => ({
  id,
  user_text: q,
  segments: segs,
  timestamp: '2026-05-18T00:00:00Z',
})

describe('ChatStream', () => {
  it('빈 pairs일 때 빈 상태 안내', () => {
    render(
      <ChatStream
        pairs={[]}
        onExpand={() => {}}
        pendingTool={null}
        onRespondTool={() => {}}
      />,
    )
    expect(screen.getByText(/첫 질문/)).toBeInTheDocument()
  })

  it('pairs를 시간순으로 카드 렌더', () => {
    const pairs = [
      pair('a', '첫째 질문', [text('첫 답변')]),
      pair('b', '둘째 질문', [text('둘째 답변')]),
    ]
    render(
      <ChatStream
        pairs={pairs}
        onExpand={() => {}}
        pendingTool={null}
        onRespondTool={() => {}}
      />,
    )
    expect(screen.getByText('첫째 질문')).toBeInTheDocument()
    expect(screen.getByText('둘째 질문')).toBeInTheDocument()
  })

  it('전체보기 버튼 클릭 시 onExpand(id) 호출', () => {
    const onExpand = vi.fn()
    const long = 'a'.repeat(600)
    const pairs = [pair('a', 'q', [text(long)])]
    render(
      <ChatStream
        pairs={pairs}
        onExpand={onExpand}
        pendingTool={null}
        onRespondTool={() => {}}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: '대화 전체보기' }))
    expect(onExpand).toHaveBeenCalledWith('a')
  })

  it('마지막 페어 segments가 비어 있으면 인디케이터 표시', () => {
    const pairs = [pair('a', 'q', [])]
    render(
      <ChatStream
        pairs={pairs}
        onExpand={() => {}}
        pendingTool={null}
        onRespondTool={() => {}}
        turnInProgress
      />,
    )
    // verb 회전이라 정확한 라벨은 고정하지 않고 인디케이터 자체의 존재만 확인.
    expect(screen.getByRole('status')).toBeInTheDocument()
  })

  it('마지막 segment가 tool_use면 도구명을 인디케이터로 표시', () => {
    const tool = {
      kind: 'tool_use' as const,
      id: 'tu1',
      name: 'Bash',
      summary: 'ls',
      input: {},
    }
    const pairs = [pair('a', 'q', [tool])]
    render(
      <ChatStream
        pairs={pairs}
        onExpand={() => {}}
        pendingTool={null}
        onRespondTool={() => {}}
        turnInProgress
      />,
    )
    expect(screen.getByText('Bash…')).toBeInTheDocument()
  })

  it('turnInProgress=false면 완료된 페어가 있어도 인디케이터를 표시하지 않음', () => {
    const pairs = [pair('a', 'q', [text('완료된 응답')])]
    render(
      <ChatStream
        pairs={pairs}
        onExpand={() => {}}
        pendingTool={null}
        onRespondTool={() => {}}
        turnInProgress={false}
      />,
    )
    expect(screen.queryByRole('status')).toBeNull()
  })

  it('pendingTool prop 있으면 ToolApprovalCard 렌더', () => {
    const req: ToolRequest = {
      request_id: 'r1',
      tool_name: 'Edit',
      input: { file_path: '/x' },
      tool_use_id: 'tu-1',
    }
    render(
      <ChatStream
        pairs={[pair('a', 'q', [text('answer')])]}
        onExpand={() => {}}
        pendingTool={req}
        onRespondTool={() => {}}
        turnInProgress
      />,
    )
    expect(
      screen.getByRole('region', { name: '도구 승인 요청' }),
    ).toBeInTheDocument()
  })

  it('도구 승인 버튼 클릭 시 onRespondTool(request_id, true, tool_use_id) 호출', () => {
    const onRespondTool = vi.fn()
    const req: ToolRequest = {
      request_id: 'r1',
      tool_name: 'Edit',
      input: {},
      tool_use_id: 'tu-7',
    }
    render(
      <ChatStream
        pairs={[]}
        onExpand={() => {}}
        pendingTool={req}
        onRespondTool={onRespondTool}
        turnInProgress
      />,
    )
    fireEvent.click(screen.getByText('예 (한 번 허용)'))
    expect(onRespondTool).toHaveBeenCalledWith(
      'r1',
      true,
      'tu-7',
      undefined,
      undefined,
    )
  })

  it('pendingTool이 있으면 진행 인디케이터는 표시하지 않음', () => {
    const req: ToolRequest = {
      request_id: 'r1',
      tool_name: 'Edit',
      input: {},
      tool_use_id: null,
    }
    const pairs = [pair('a', 'q', [])]
    render(
      <ChatStream
        pairs={pairs}
        onExpand={() => {}}
        pendingTool={req}
        onRespondTool={() => {}}
        turnInProgress
      />,
    )
    expect(screen.queryByRole('status')).toBeNull()
  })
})
