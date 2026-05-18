import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import { ToolUseView } from './index'
import type { AssistantSegment } from '../../types'

type ToolUse = Extract<AssistantSegment, { kind: 'tool_use' }>

const t = (name: string, input: unknown): ToolUse => ({
  kind: 'tool_use',
  id: 'tu',
  name,
  summary: '',
  input,
})

describe('ToolUseView', () => {
  it('Bash: command를 코드 블록으로 표시', () => {
    render(<ToolUseView segment={t('Bash', { command: 'ls -la' })} />)
    expect(screen.getByText('Bash')).toBeInTheDocument()
    expect(screen.getByText('ls -la')).toBeInTheDocument()
  })

  it('Edit: file_path 헤더와 변경 보기 토글', () => {
    render(
      <ToolUseView
        segment={t('Edit', {
          file_path: '/x/y.ts',
          old_string: 'before',
          new_string: 'after',
        })}
      />,
    )
    expect(screen.getByText('Edit')).toBeInTheDocument()
    expect(screen.getByText('/x/y.ts')).toBeInTheDocument()
    expect(screen.getByText('변경 보기')).toBeInTheDocument()
  })

  it('Edit: details를 펼치면 old/new 두 블록 표시', () => {
    render(
      <ToolUseView
        segment={t('Edit', {
          file_path: '/a',
          old_string: 'aa',
          new_string: 'bb',
        })}
      />,
    )
    fireEvent.click(screen.getByText('변경 보기'))
    expect(screen.getByText(/- aa/)).toBeInTheDocument()
    expect(screen.getByText(/\+ bb/)).toBeInTheDocument()
  })

  it('Write: file_path와 줄 수 hint', () => {
    render(
      <ToolUseView
        segment={t('Write', {
          file_path: '/new.ts',
          content: 'a\nb\nc',
        })}
      />,
    )
    expect(screen.getByText('/new.ts')).toBeInTheDocument()
    expect(screen.getByText('3 lines')).toBeInTheDocument()
  })

  it('Read: file_path만 헤더에 표시 (본문 없음)', () => {
    render(<ToolUseView segment={t('Read', { file_path: '/a.ts' })} />)
    expect(screen.getByText('/a.ts')).toBeInTheDocument()
    expect(screen.queryByText(/lines$/)).toBeNull()
  })

  it('TodoWrite: 체크리스트 항목을 상태별로 표시', () => {
    render(
      <ToolUseView
        segment={t('TodoWrite', {
          todos: [
            { content: 'do A', status: 'completed', activeForm: 'doing A' },
            { content: 'do B', status: 'in_progress', activeForm: 'doing B' },
            { content: 'do C', status: 'pending', activeForm: 'doing C' },
          ],
        })}
      />,
    )
    expect(screen.getByText('do A')).toBeInTheDocument()
    expect(screen.getByText('doing B')).toBeInTheDocument()
    expect(screen.getByText('do C')).toBeInTheDocument()
  })

  it('Generic: 알려진 도구가 아니면 JSON.stringify로 fallback', () => {
    render(<ToolUseView segment={t('UnknownTool', { foo: 'bar' })} />)
    expect(screen.getByText('UnknownTool')).toBeInTheDocument()
  })
})
