import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { invoke } from '@tauri-apps/api/core'
import { FileExplorer } from './index'

const mockInvoke = vi.mocked(invoke)

const rootEntries = [
  { name: 'src', path: '/proj/src', is_dir: true },
  { name: 'README.md', path: '/proj/README.md', is_dir: false },
]
const srcEntries = [{ name: 'index.ts', path: '/proj/src/index.ts', is_dir: false }]

function setupInvoke() {
  mockInvoke.mockImplementation((cmd: string, args?: any) => {
    if (cmd === 'watch_project') return Promise.resolve(rootEntries)
    if (cmd === 'list_dir') {
      if (args?.path === '/proj/src') return Promise.resolve(srcEntries)
      return Promise.resolve([])
    }
    return Promise.resolve()
  })
}

function renderExplorer(props?: Partial<Parameters<typeof FileExplorer>[0]>) {
  return render(
    <FileExplorer
      projectPath="/proj"
      activePath={null}
      onOpenFile={vi.fn()}
      {...props}
    />,
  )
}

beforeEach(() => {
  mockInvoke.mockReset()
  setupInvoke()
})

describe('FileExplorer', () => {
  it('renders the root listing from watch_project', async () => {
    renderExplorer()
    expect(await screen.findByText('src')).toBeInTheDocument()
    expect(screen.getByText('README.md')).toBeInTheDocument()
  })

  it('collapses all expanded folders', async () => {
    renderExplorer()
    fireEvent.click(await screen.findByText('src'))
    expect(await screen.findByText('index.ts')).toBeInTheDocument()

    fireEvent.click(screen.getByLabelText('모두 접기'))
    await waitFor(() =>
      expect(screen.queryByText('index.ts')).not.toBeInTheDocument(),
    )
  })

  it('creates a new file at the root via the toolbar', async () => {
    renderExplorer()
    await screen.findByText('README.md')

    fireEvent.click(screen.getByLabelText('새 파일'))
    const input = screen.getByRole('textbox')
    fireEvent.change(input, { target: { value: 'new.ts' } })
    fireEvent.keyDown(input, { key: 'Enter' })

    await waitFor(() =>
      expect(mockInvoke).toHaveBeenCalledWith('create_entry', {
        path: '/proj/new.ts',
        isDir: false,
      }),
    )
  })

  it('renames a file through the context menu', async () => {
    const onPathRenamed = vi.fn()
    renderExplorer({ onPathRenamed })
    const row = await screen.findByText('README.md')

    fireEvent.contextMenu(row)
    fireEvent.click(screen.getByText('이름 바꾸기'))

    const input = screen.getByRole('textbox') as HTMLInputElement
    expect(input.value).toBe('README.md')
    fireEvent.change(input, { target: { value: 'READ.md' } })
    fireEvent.keyDown(input, { key: 'Enter' })

    await waitFor(() =>
      expect(mockInvoke).toHaveBeenCalledWith('rename_entry', {
        from: '/proj/README.md',
        to: '/proj/READ.md',
      }),
    )
    expect(onPathRenamed).toHaveBeenCalledWith('/proj/README.md', '/proj/READ.md')
  })

  it('deletes a file after confirmation', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true)
    const onPathDeleted = vi.fn()
    renderExplorer({ onPathDeleted })
    const row = await screen.findByText('README.md')

    fireEvent.contextMenu(row)
    fireEvent.click(screen.getByText('삭제'))

    await waitFor(() =>
      expect(mockInvoke).toHaveBeenCalledWith('delete_entry', {
        path: '/proj/README.md',
      }),
    )
    expect(onPathDeleted).toHaveBeenCalledWith('/proj/README.md')
    confirmSpy.mockRestore()
  })

  it('does not delete when confirmation is declined', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false)
    renderExplorer()
    const row = await screen.findByText('README.md')

    fireEvent.contextMenu(row)
    fireEvent.click(screen.getByText('삭제'))

    expect(mockInvoke).not.toHaveBeenCalledWith('delete_entry', expect.anything())
    confirmSpy.mockRestore()
  })

  it('moves a file via drag and drop onto a folder', async () => {
    const onPathRenamed = vi.fn()
    renderExplorer({ onPathRenamed })
    const fileRow = await screen.findByText('README.md')
    const folderRow = screen.getByText('src')

    const dataTransfer = {
      effectAllowed: '',
      dropEffect: '',
      setData: vi.fn(),
      getData: vi.fn(),
    }
    fireEvent.dragStart(fileRow, { dataTransfer })
    fireEvent.dragOver(folderRow, { dataTransfer })
    fireEvent.drop(folderRow, { dataTransfer })

    await waitFor(() =>
      expect(mockInvoke).toHaveBeenCalledWith('rename_entry', {
        from: '/proj/README.md',
        to: '/proj/src/README.md',
      }),
    )
    expect(onPathRenamed).toHaveBeenCalledWith(
      '/proj/README.md',
      '/proj/src/README.md',
    )
  })
})
