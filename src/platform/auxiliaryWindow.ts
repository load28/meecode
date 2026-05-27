/**
 * VS Code `auxiliaryWindowService` equivalent: open a `window.open` child that
 * shares this renderer's JS context (so all services/stores/Monaco are the same
 * instances — no cross-window sync), and replicate the main window's stylesheets
 * into it (and future lazy injections) so portaled UI renders styled. Proven by
 * the M0/M0.5 spike (electron/renderer) to host a Monaco editor correctly.
 */
export interface AuxiliaryWindow {
  window: Window
  /** Mount point for a React portal. */
  container: HTMLElement
  /** Programmatic close (docking); also triggers the window's unload path. */
  close: () => void
}

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

export function openAuxiliaryWindow(opts: {
  title?: string
  width?: number
  height?: number
  onClose?: () => void
}): AuxiliaryWindow | null {
  const features = `width=${opts.width ?? 960},height=${opts.height ?? 720}`
  const win = window.open('about:blank', '_blank', features)
  if (!win) return null
  win.document.title = opts.title ?? 'MeeCode'

  const obs = syncStyles(win)
  const reset = win.document.createElement('style')
  reset.textContent =
    'html,body{margin:0;height:100%;overflow:hidden}#aux-root{position:absolute;inset:0;display:flex;flex-direction:column}'
  win.document.head.appendChild(reset)

  const container = win.document.createElement('div')
  container.id = 'aux-root'
  win.document.body.appendChild(container)

  let closed = false
  const fireClose = () => {
    if (closed) return
    closed = true
    obs.disconnect()
    opts.onClose?.()
  }
  win.addEventListener('beforeunload', fireClose)
  // The aux window must not outlive the main window.
  const onMainUnload = () => win.close()
  window.addEventListener('beforeunload', onMainUnload)

  return {
    window: win,
    container,
    close: () => {
      window.removeEventListener('beforeunload', onMainUnload)
      fireClose()
      win.close()
    },
  }
}
