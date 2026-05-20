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

  it('"거부 + 의견 전달" 클릭 시 메시지 입력 폼이 열림', () => {
    const onRespond = vi.fn()
    render(<ToolApprovalCard request={editReq} onRespond={onRespond} />)
    fireEvent.click(screen.getByText('거부 + 의견 전달'))
    expect(screen.getByLabelText(/Claude에게 전달할 내용/)).toBeInTheDocument()
    // 폼이 열리기만 했고 아직 응답은 전송되지 않아야 함.
    expect(onRespond).not.toHaveBeenCalled()
  })

  it('거부 메시지를 입력 후 전송 시 denialMessage 인자로 전달됨', () => {
    const onRespond = vi.fn()
    render(<ToolApprovalCard request={editReq} onRespond={onRespond} />)
    fireEvent.click(screen.getByText('거부 + 의견 전달'))
    const textarea = screen.getByLabelText(/Claude에게 전달할 내용/)
    fireEvent.change(textarea, { target: { value: '백업 먼저 만들어줘' } })
    fireEvent.click(screen.getByText('거부 + 전송'))
    expect(onRespond).toHaveBeenCalledWith(false, undefined, '백업 먼저 만들어줘')
  })

  it('Cmd/Ctrl + Enter로도 거부 메시지를 전송할 수 있음', () => {
    const onRespond = vi.fn()
    render(<ToolApprovalCard request={editReq} onRespond={onRespond} />)
    fireEvent.click(screen.getByText('거부 + 의견 전달'))
    const textarea = screen.getByLabelText(/Claude에게 전달할 내용/)
    fireEvent.change(textarea, { target: { value: '대신 PR 설명에만 적어줘' } })
    fireEvent.keyDown(textarea, { key: 'Enter', metaKey: true })
    expect(onRespond).toHaveBeenCalledWith(false, undefined, '대신 PR 설명에만 적어줘')
  })

  it('빈 메시지로는 전송 버튼이 비활성', () => {
    const onRespond = vi.fn()
    render(<ToolApprovalCard request={editReq} onRespond={onRespond} />)
    fireEvent.click(screen.getByText('거부 + 의견 전달'))
    expect(screen.getByText('거부 + 전송')).toBeDisabled()
  })

  it('취소 버튼은 다시 옵션 목록으로 되돌림', () => {
    const onRespond = vi.fn()
    render(<ToolApprovalCard request={editReq} onRespond={onRespond} />)
    fireEvent.click(screen.getByText('거부 + 의견 전달'))
    fireEvent.click(screen.getByText('취소'))
    // 폼이 닫히고 옵션 라벨이 다시 보여야 한다.
    expect(screen.queryByLabelText(/Claude에게 전달할 내용/)).toBeNull()
    expect(screen.getByText('예 (한 번 허용)')).toBeInTheDocument()
    expect(onRespond).not.toHaveBeenCalled()
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
