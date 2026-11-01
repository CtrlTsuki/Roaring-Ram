// Test helper: a child process that allocates memory on request so the Win32 actions can be
// measured against a real process. Commands arrive on stdin, one per line:
//   alloc <MB>  allocate and touch that many MB; replies "ok <totalMB>" or "fail <message>"
//   touch       re-touch every page held; replies "ok"
//   spawn       start a child process the plain way; replies "ok <pid>"
//   spawnjob    start a child inside Node's own job object; replies "ok <pid>"
const held = []
const kids = []
process.on('exit', () => kids.forEach((k) => k.kill()))
let total = 0
process.stdin.setEncoding('utf8')
let pending = ''
process.stdin.on('data', (chunk) => {
  pending += chunk
  let i
  while ((i = pending.indexOf('\n')) >= 0) {
    const line = pending.slice(0, i).trim()
    pending = pending.slice(i + 1)
    handle(line)
  }
})

function handle(line) {
  const [cmd, arg] = line.split(' ')
  try {
    if (cmd === 'alloc') {
      const mb = Number(arg)
      for (let n = 0; n < mb; n += 10) {
        const b = Buffer.allocUnsafeSlow(Math.min(10, mb - n) * 1024 * 1024)
        b.fill(1)
        held.push(b)
      }
      total += mb
      process.stdout.write(`ok ${total}\n`)
    } else if (cmd === 'spawn' || cmd === 'spawnjob') {
      // 'spawn' starts a child the plain Windows way, as most apps launch another program.
      // 'spawnjob' uses Node's default, which adds the child to Node's own job, as some apps do.
      const child = require('node:child_process').spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], {
        stdio: 'ignore',
        detached: cmd === 'spawn'
      })
      kids.push(child)
      process.stdout.write(`ok ${child.pid}\n`)
    } else if (cmd === 'touch') {
      for (const b of held) for (let j = 0; j < b.length; j += 4096) b[j] = (b[j] + 1) & 0xff
      process.stdout.write('ok\n')
    }
  } catch (e) {
    process.stdout.write(`fail ${String(e && e.message).replace(/\n/g, ' ')}\n`)
  }
}
process.stdout.write('ready\n')
