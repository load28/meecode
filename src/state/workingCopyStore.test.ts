import { describe, it, expect } from 'vitest'
import * as monaco from 'monaco-editor'
import { isDirty, markClean, registerWorkingCopy } from './workingCopyStore'

describe('workingCopyStore', () => {
  it('marks dirty on edit and clean again on save', () => {
    const model = monaco.editor.createModel(
      'hello',
      'plaintext',
      monaco.Uri.parse('inmemory:///wc-test-1'),
    )
    registerWorkingCopy('wc-test-1', model)
    expect(isDirty('wc-test-1')).toBe(false)

    model.setValue('hello world')
    expect(isDirty('wc-test-1')).toBe(true)

    markClean('wc-test-1')
    expect(isDirty('wc-test-1')).toBe(false)

    model.dispose()
  })

  it('clears dirty when edits are undone back to the saved state', async () => {
    const model = monaco.editor.createModel(
      'a',
      'plaintext',
      monaco.Uri.parse('inmemory:///wc-test-2'),
    )
    registerWorkingCopy('wc-test-2', model)

    model.pushEditOperations(
      [],
      [{ range: new monaco.Range(1, 2, 1, 2), text: 'bc' }],
      () => null,
    )
    expect(isDirty('wc-test-2')).toBe(true)

    await model.undo()
    expect(isDirty('wc-test-2')).toBe(false)

    model.dispose()
  })
})
