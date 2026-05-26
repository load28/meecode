import * as monaco from 'monaco-editor'
// Inline (blob) worker — robust under both http (dev) and file:// (built).
import EditorWorker from 'monaco-editor/esm/vs/editor/editor.worker?worker&inline'

self.MonacoEnvironment = { getWorker: () => new EditorWorker() }

interface MeecodeBridge {
  invoke(cmd: string, args?: unknown): Promise<unknown>
  on(channel: string, cb: (payload: unknown) => void): () => void
  report(data: unknown): void
}
declare global {
  interface Window {
    meecode: MeecodeBridge
  }
}

const statusEl = document.getElementById('status')!
const log = (s: string) => {
  statusEl.textContent += `\n${s}`
}

// Mirror this window's stylesheets into a child window and keep them in sync as
// Monaco lazily injects more (VSCode's createContainer + sharedMutationObserver).
function syncStyles(target: Window): MutationObserver {
  const copy = (node: Element) => {
    if (node.tagName === 'STYLE') {
      const s = target.document.createElement('style')
      s.textContent = node.textContent
      target.document.head.appendChild(s)
    } else if (node.tagName === 'LINK' && (node as HTMLLinkElement).rel === 'stylesheet') {
      const l = target.document.createElement('link')
      l.rel = 'stylesheet'
      l.href = (node as HTMLLinkElement).href
      target.document.head.appendChild(l)
    }
  }
  document.head.querySelectorAll('style, link[rel=stylesheet]').forEach(copy)
  const obs = new MutationObserver((muts) => {
    for (const m of muts) m.addedNodes.forEach((n) => n instanceof Element && copy(n))
  })
  obs.observe(document.head, { childList: true })
  return obs
}

async function run(): Promise<void> {
  const result: Record<string, unknown> = {}

  // ── M0: sidecar ndjson round-trip ────────────────────────────────────────
  try {
    const ping = await window.meecode.invoke('ping', { hello: 'm0' })
    result.ping = ping
    statusEl.textContent = `M0 sidecar ping → ${JSON.stringify(ping)}`
  } catch (e) {
    result.pingError = String(e)
    statusEl.textContent = `M0 sidecar ping FAILED: ${String(e)}`
  }
  window.meecode.on('sidecar:ready', (p) => log(`event sidecar:ready → ${JSON.stringify(p)}`))

  // ── M0.5: single monaco instance, completion provider, child window ──────
  monaco.languages.register({ id: 'spikelang' })
  monaco.languages.registerCompletionItemProvider('spikelang', {
    provideCompletionItems(model, position) {
      const word = model.getWordUntilPosition(position)
      const range = {
        startLineNumber: position.lineNumber,
        endLineNumber: position.lineNumber,
        startColumn: word.startColumn,
        endColumn: word.endColumn,
      }
      const item = (label: string, insertText: string): monaco.languages.CompletionItem => ({
        label,
        kind: monaco.languages.CompletionItemKind.Function,
        insertText,
        range,
        detail: 'shared renderer · single registry',
      })
      return {
        suggestions: [
          item('sharedRendererWorks', 'sharedRendererWorks()'),
          item('auxWindowCompletion', 'auxWindowCompletion()'),
          item('vscodeStyleArchitecture', 'vscodeStyleArchitecture()'),
        ],
      }
    },
  })

  let childOpened = false
  try {
    const child = window.open('about:blank', 'aux-editor', 'width=900,height=620')
    if (!child) throw new Error('window.open returned null (popup blocked)')
    childOpened = true
    child.document.title = 'Aux Editor (shared renderer)'
    // VSCode auxiliaryWindowService.createContainer(): Monaco injects its CSS
    // into THIS window's <head>; replicate it (and future lazy injections) into
    // the child window or the editor renders unstyled.
    syncStyles(child)
    const style = child.document.createElement('style')
    style.textContent =
      'html,body{margin:0;height:100%;overflow:hidden;background:#1e1e1e}#ed{position:absolute;inset:0}'
    child.document.head.appendChild(style)
    const container = child.document.createElement('div')
    container.id = 'ed'
    child.document.body.appendChild(container)

    const model = monaco.editor.createModel('// aux window — type triggers completion\nshared', 'spikelang')
    const editor = monaco.editor.create(container, {
      model,
      theme: 'vs-dark',
      automaticLayout: true,
      minimap: { enabled: false },
      fontSize: 16,
    })
    log('M0.5 monaco created in child window')

    // Place caret after "shared" and trigger the suggest widget so the dropdown
    // renders *inside the child window* — visual proof of multi-window features.
    editor.focus()
    editor.setPosition({ lineNumber: 2, column: 7 })
    setTimeout(() => {
      editor.trigger('spike', 'editor.action.triggerSuggest', {})
      setTimeout(() => {
        result.childOpened = childOpened
        window.meecode.report(result)
      }, 700)
    }, 500)
  } catch (e) {
    log(`M0.5 child window FAILED: ${String(e)}`)
    result.childError = String(e)
    result.childOpened = childOpened
    window.meecode.report(result)
  }
}

void run()
