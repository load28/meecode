import { spawn, type ChildProcess } from 'node:child_process'

interface Pending {
  resolve: (v: unknown) => void
  reject: (e: unknown) => void
}

/**
 * Sidecar broker (M0): spawns a child process and speaks line-delimited JSON
 * (ndjson) over its stdio — `{t:'req'|'res'|'evt', ...}`. In M2 the child is the
 * compiled Rust binary; for the spike it's a Node stub that proves the plumbing.
 */
export class Sidecar {
  private child!: ChildProcess
  private seq = 0
  private readonly pending = new Map<number, Pending>()
  private buf = ''

  constructor(
    private readonly scriptPath: string,
    private readonly onEvent: (channel: string, payload: unknown) => void = () => {},
  ) {}

  start(): void {
    // Run the stub through Electron's bundled Node (ELECTRON_RUN_AS_NODE) so we
    // don't assume a system node — mirrors how the Rust binary will be spawned.
    this.child = spawn(process.execPath, [this.scriptPath], {
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
      stdio: ['pipe', 'pipe', 'inherit'],
    })
    this.child.stdout!.setEncoding('utf8')
    this.child.stdout!.on('data', (chunk: string) => this.onData(chunk))
  }

  private onData(chunk: string): void {
    this.buf += chunk
    let nl: number
    while ((nl = this.buf.indexOf('\n')) >= 0) {
      const line = this.buf.slice(0, nl).trim()
      this.buf = this.buf.slice(nl + 1)
      if (!line) continue
      let msg: { t: string; id?: number; ok?: boolean; result?: unknown; error?: string; channel?: string; payload?: unknown }
      try {
        msg = JSON.parse(line)
      } catch {
        continue
      }
      if (msg.t === 'res' && typeof msg.id === 'number') {
        const p = this.pending.get(msg.id)
        if (p) {
          this.pending.delete(msg.id)
          if (msg.ok) p.resolve(msg.result)
          else p.reject(new Error(msg.error ?? 'sidecar error'))
        }
      } else if (msg.t === 'evt' && msg.channel) {
        this.onEvent(msg.channel, msg.payload)
      }
    }
  }

  request(cmd: string, args: unknown): Promise<unknown> {
    const id = ++this.seq
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject })
      this.child.stdin!.write(JSON.stringify({ t: 'req', id, cmd, args }) + '\n')
    })
  }

  stop(): void {
    this.child?.kill()
  }
}
