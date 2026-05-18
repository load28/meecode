import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import { ToolApprovalCard } from './index'
import type { ToolRequest } from '../../types'

const req: ToolRequest = {
  request_id: 'r1',
  tool_name: 'Edit',
  input: { file_path: '/x/y.ts' },
  tool_use_id: 'tu-1',
}

describe('ToolApprovalCard', () => {
  it('도구 이름과 입력 요약을 표시', () => {
    render(<ToolApprovalCard request={req} onRespond={() => {}} />)
    expect(screen.getByText('Edit')).toBeInTheDocument()
    expect(screen.getByText(/\/x\/y\.ts/)).toBeInTheDocument()
  })

  it('"허용" 클릭 시 onRespond(true)', () => {
    const onRespond = vi.fn()
    render(<ToolApprovalCard request={req} onRespond={onRespond} />)
    fireEvent.click(screen.getByRole('button', { name: '허용' }))
    expect(onRespond).toHaveBeenCalledWith(true)
  })

  it('"거부" 클릭 시 onRespond(false)', () => {
    const onRespond = vi.fn()
    render(<ToolApprovalCard request={req} onRespond={onRespond} />)
    fireEvent.click(screen.getByRole('button', { name: '거부' }))
    expect(onRespond).toHaveBeenCalledWith(false)
  })

  it('Bash 도구는 command를 요약으로 표시', () => {
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
})
