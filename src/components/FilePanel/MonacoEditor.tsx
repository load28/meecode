import { useEffect, useRef } from 'react'
import * as monaco from 'monaco-editor'
import type { FileTab } from '../../hooks/useFileTabs'
import type { CodeSnippet } from '../../types/composer'
import {
  EDITOR_FONT_FAMILY,
  EDITOR_THEME,
  setupMonaco,
} from '../../editor/monacoSetup'
import {
  flushPendingDisposals,
  getOrCreateModel,
  saveViewState,
  setTruncated,
  takeViewState,
  toMonacoLanguage,
} from '../../editor/models'
import { consumePendingReveal } from '../../editor/navigation'
import { ensureLanguageActivated } from '../../editor/plugins/registry'
import { isDirty, markClean, registerWorkingCopy } from '../../state/workingCopyStore'

interface Props {
  tab: FileTab
  readOnly: boolean
  /** Ctrl/Cmd+S on the focused editor. */
  onSave: () => void
  onAddSelectionToComposer: (snippet: CodeSnippet) => void
}

/**
 * Single reused Monaco editor instance. The view re-attaches to a different
 * model on tab switch (VS Code's single-pane reuse) instead of being recreated,
 * and per-file view state (cursor/scroll/folding) is saved and restored.
 */
export function MonacoEditor({
  tab,
  readOnly,
  onSave,
  onAddSelectionToComposer,
}: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const editorRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null)
  const currentPathRef = useRef<string | null>(null)

  // Latest callbacks reachable from the editor's stable command/widget without
  // re-creating the editor on every prop change.
  const onSaveRef = useRef(onSave)
  onSaveRef.current = onSave
  const onAddRef = useRef(onAddSelectionToComposer)
  onAddRef.current = onAddSelectionToComposer

  useEffect(() => {
    setupMonaco()
    const el = containerRef.current
    if (!el) return

    const editor = monaco.editor.create(el, {
      theme: EDITOR_THEME,
      automaticLayout: true,
      fontFamily: EDITOR_FONT_FAMILY,
      fontLigatures: true,
      fontSize: 13,
      lineHeight: 20,
      minimap: { enabled: true },
      scrollBeyondLastLine: false,
      renderWhitespace: 'selection',
      renderLineHighlight: 'all',
      smoothScrolling: true,
      cursorBlinking: 'smooth',
      cursorSmoothCaretAnimation: 'on',
      // Indentation defaults; Monaco overrides per-file from detected content,
      // so Go/Python tabs aren't forced to 2 spaces.
      tabSize: 2,
      detectIndentation: true,
      fixedOverflowWidgets: true,
      // VS Code-grade affordances now that real language features back them.
      bracketPairColorization: { enabled: true },
      guides: { bracketPairs: 'active', indentation: true, highlightActiveIndentation: true },
      matchBrackets: 'always',
      occurrencesHighlight: 'singleFile',
      stickyScroll: { enabled: true },
      linkedEditing: true,
      inlayHints: { enabled: 'on' },
      suggest: { preview: true, showStatusBar: true },
      suggestSelection: 'first',
      padding: { top: 6, bottom: 6 },
      scrollbar: { verticalScrollbarSize: 14, horizontalScrollbarSize: 14 },
    })
    editorRef.current = editor

    const emitSelection = () => {
      const model = editor.getModel()
      const sel = editor.getSelection()
      if (!model || !sel || sel.isEmpty()) return
      onAddRef.current({
        text: model.getValueInRange(sel),
        path: currentPathRef.current ?? '',
        startLine: sel.startLineNumber,
        endLine: sel.endLineNumber,
      })
    }

    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => {
      onSaveRef.current()
    })
    editor.addAction({
      id: 'meecode.addSelectionToComposer',
      label: '코멘트로 추가',
      contextMenuGroupId: 'navigation',
      contextMenuOrder: 1.5,
      run: emitSelection,
    })

    // Floating "add to composer" affordance over a non-empty selection,
    // preserving the read-only viewer's UX via a Monaco content widget.
    const widgetNode = document.createElement('div')
    widgetNode.className = 'file-panel__editor-comment'
    const widgetBtn = document.createElement('button')
    widgetBtn.type = 'button'
    widgetBtn.textContent = '💬 코멘트로 추가'
    widgetBtn.addEventListener('mousedown', (e) => e.preventDefault())
    widgetBtn.addEventListener('click', emitSelection)
    widgetNode.appendChild(widgetBtn)

    const commentWidget: monaco.editor.IContentWidget = {
      getId: () => 'meecode.selectionComment',
      getDomNode: () => widgetNode,
      getPosition: () => {
        const sel = editor.getSelection()
        if (!sel || sel.isEmpty()) return null
        return {
          position: { lineNumber: sel.startLineNumber, column: sel.startColumn },
          preference: [
            monaco.editor.ContentWidgetPositionPreference.ABOVE,
            monaco.editor.ContentWidgetPositionPreference.BELOW,
          ],
        }
      },
    }
    editor.addContentWidget(commentWidget)
    const selSub = editor.onDidChangeCursorSelection(() => {
      editor.layoutContentWidget(commentWidget)
    })

    return () => {
      if (currentPathRef.current) {
        saveViewState(currentPathRef.current, editor.saveViewState())
      }
      selSub.dispose()
      editor.dispose()
      editorRef.current = null
    }
  }, [])

  // Swap the model when the active file changes; silently refresh a clean
  // model whose disk baseline moved (VS Code reloads clean files in place).
  useEffect(() => {
    const editor = editorRef.current
    if (!editor) return

    const prevPath = currentPathRef.current
    if (prevPath && prevPath !== tab.path) {
      saveViewState(prevPath, editor.saveViewState())
    }

    const model = getOrCreateModel(tab)
    registerWorkingCopy(tab.path, model)
    // Record truncation before activating so the LSP layer skips partial files.
    setTruncated(tab.path, !tab.virtual && tab.truncated)
    // Activation trigger: bring up the language's plugin (grammar / server) the
    // first time a file of that language is shown, if the user enabled it.
    ensureLanguageActivated(toMonacoLanguage(tab.language))

    if (!isDirty(tab.path) && model.getValue() !== tab.content) {
      model.setValue(tab.content)
      markClean(tab.path)
    }

    if (editor.getModel() !== model) {
      editor.setModel(model)
      const vs = takeViewState(tab.path)
      if (vs) editor.restoreViewState(vs)
      editor.focus()
    }
    // A cross-file Go-to-Definition / reference jump routed through here leaves
    // a target range to reveal once the file is shown.
    const reveal = consumePendingReveal(tab.path)
    if (reveal) {
      editor.setSelection(reveal)
      editor.revealRangeInCenterIfOutsideViewport(reveal)
      editor.focus()
    }
    // Any model closed while it was still on screen can now be disposed.
    flushPendingDisposals()
    currentPathRef.current = tab.path
  }, [tab.path, tab.content, tab.language, tab.virtual, tab.truncated])

  useEffect(() => {
    editorRef.current?.updateOptions({ readOnly })
  }, [readOnly])

  return <div ref={containerRef} className="file-panel__editor" />
}
