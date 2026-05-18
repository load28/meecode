import { render } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import { TerminalPane } from './index'

vi.mock('@xterm/xterm', () => ({
  Terminal: vi.fn().mockImplementation(() => ({
    open: vi.fn(),
    write: vi.fn(),
    onData: vi.fn(),
    dispose: vi.fn(),
    loadAddon: vi.fn(),
  })),
}))

vi.mock('@xterm/addon-fit', () => ({
  FitAddon: vi.fn().mockImplementation(() => ({
    fit: vi.fn(),
    activate: vi.fn(),
  })),
}))

describe('TerminalPane', () => {
  it('터미널 컨테이너 div를 렌더링', () => {
    const { container } = render(<TerminalPane />)
    expect(container.querySelector('.terminal-container')).toBeInTheDocument()
  })
})
