import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import { ToolApprovalCard } from './index'
import type { ToolRequest } from '../../types'

const editReq: ToolRequest = {
  request_id: 'r1',
  tool_name: 'Edit',
  input: {
    file_path: '/x/y.ts',
    old_string: 'const a = 1',
    new_string: 'const a = 2',
  },
  tool_use_id: 'tu-1',
}

describe('ToolApprovalCard', () => {
  it('Edit 도구는 파일 경로와 diff 미리보기를 표시', () => {
    render(<ToolApprovalCard request={editReq} onRespond={() => {}} />)
    expect(screen.getByText('Edit')).toBeInTheDocument()
    expect(screen.getByText(/\/x\/y\.ts/)).toBeInTheDocument()
    // The DiffView renders the new line text in the new pane.
    expect(screen.getByText('const a = 2')).toBeInTheDocument()
  })

  it('"예 (한 번 허용)" 클릭 시 onRespond(true)', () => {
    const onRespond = vi.fn()
    render(<ToolApprovalCard request={editReq} onRespond={onRespond} />)
    fireEvent.click(screen.getByText('예 (한 번 허용)'))
    expect(onRespond).toHaveBeenCalledWith(true)
  })

  it('"거부" 클릭 시 onRespond(false)', () => {
    const onRespond = vi.fn()
    render(<ToolApprovalCard request={editReq} onRespond={onRespond} />)
    fireEvent.click(screen.getByText('거부'))
    expect(onRespond).toHaveBeenCalledWith(false)
  })

  it('Bash 도구는 command를 요약으로 표시하고 diff는 없음', () => {
    render(
      <ToolApprovalCard
        request={{
          request_id: 'r2',
          tool_name: 'Bash',
          input: { command: 'rm -rf /tmp/x' },
          tool_use_id: null,
        }}
        onRespond={() => {}}
      />,
    )
    expect(screen.getByText('rm -rf /tmp/x')).toBeInTheDocument()
  })

  it('permission_suggestions가 있으면 "다시 묻지 않음" 옵션 추가', () => {
    const onRespond = vi.fn()
    render(
      <ToolApprovalCard
        request={{
          ...editReq,
          permission_suggestions: [
            {
              type: 'addRules',
              ruleContent: 'Edit /x/**',
              label: '예 + /x 디렉토리에 항상 허용',
            },
          ],
        }}
        onRespond={onRespond}
      />,
    )
    const alwaysOption = screen.getByText('예 + /x 디렉토리에 항상 허용')
    expect(alwaysOption).toBeInTheDocument()
    fireEvent.click(alwaysOption)
    expect(onRespond).toHaveBeenCalledTimes(1)
    const [allow, updated] = onRespond.mock.calls[0]
    expect(allow).toBe(true)
    expect(updated).toMatchObject({
      __apply_suggestion: { type: 'addRules' },
    })
  })

  it('숫자 키 1은 첫 옵션 선택, Enter도 동일', () => {
    const onRespond = vi.fn()
    render(<ToolApprovalCard request={editReq} onRespond={onRespond} />)
    const card = screen.getByRole('region', { name: '도구 승인 요청' })
    fireEvent.keyDown(card, { key: 'Enter' })
    expect(onRespond).toHaveBeenLastCalledWith(true)
    fireEvent.keyDown(card, { key: 'Escape' })
    expect(onRespond).toHaveBeenLastCalledWith(false)
  })

  it('Write 도구는 비어 있는 oldText로 diff 표시', () => {
    render(
      <ToolApprovalCard
        request={{
          request_id: 'r3',
          tool_name: 'Write',
          input: { file_path: '/new.ts', content: 'export {}' },
          tool_use_id: 'tu-2',
        }}
        onRespond={() => {}}
      />,
    )
    expect(screen.getByText('export {}')).toBeInTheDocument()
    expect(screen.getByText(/\/new\.ts/)).toBeInTheDocument()
  })
})
