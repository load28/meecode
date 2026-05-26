// Stub sidecar (M0): proves the stdio ndjson req/res/evt plumbing end-to-end.
// Replaced by the compiled Rust binary (running in an RPC loop) in M2.
let buf = ''
process.stdin.setEncoding('utf8')
process.stdin.on('data', (chunk) => {
  buf += chunk
  let nl
  while ((nl = buf.indexOf('\n')) >= 0) {
    const line = buf.slice(0, nl).trim()
    buf = buf.slice(nl + 1)
    if (!line) continue
    let msg
    try {
      msg = JSON.parse(line)
    } catch {
      continue
    }
    if (msg.t !== 'req') continue
    let ok = true
    let result
    let error
    switch (msg.cmd) {
      case 'ping':
        result = { pong: true, echo: msg.args, pid: process.pid }
        break
      default:
        ok = false
        error = `unknown cmd: ${msg.cmd}`
    }
    process.stdout.write(JSON.stringify({ t: 'res', id: msg.id, ok, result, error }) + '\n')
  }
})

// Demonstrate the event channel (rust → main → renderer in the real thing).
process.stdout.write(JSON.stringify({ t: 'evt', channel: 'sidecar:ready', payload: { at: Date.now() } }) + '\n')
