// Integration tests against the real Windows APIs, using a child process we own.
import { afterEach, describe, expect, test } from 'vitest'
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { MB, GB } from '../src/shared/format'

const isWindows = process.platform === 'win32'
const win32 = isWindows ? await import('../src/main/win32') : (null as never)
const hogPath = fileURLToPath(new URL('./fixtures/hog.cjs', import.meta.url))

const children: ChildProcessWithoutNullStreams[] = []
afterEach(() => {
  for (const c of children.splice(0)) c.kill()
})

async function hog(): Promise<{ pid: number; send: (cmd: string) => Promise<string> }> {
  const child = spawn(process.execPath, [hogPath], { stdio: 'pipe' })
  children.push(child)
  const lines: string[] = []
  const waiters: ((l: string) => void)[] = []
  let buf = ''
  child.stdout.setEncoding('utf8')
  child.stdout.on('data', (d: string) => {
    buf += d
    let i
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i)
      buf = buf.slice(i + 1)
      const w = waiters.shift()
      if (w) w(line)
      else lines.push(line)
    }
  })
  child.on('exit', () => {
    for (const w of waiters.splice(0)) w('exited')
  })
  const next = () => new Promise<string>((r) => (lines.length ? r(lines.shift()!) : waiters.push(r)))
  await next()
  return {
    pid: child.pid!,
    send: (cmd) => {
      child.stdin.write(cmd + '\n')
      return next()
    }
  }
}

const proc = (pid: number) => win32.processes().find((p) => p.pid === pid)!

describe.skipIf(!isWindows)('win32 monitoring', () => {
  test('system memory figures are consistent', () => {
    const s = win32.systemMemory()
    expect(s.totalPhys).toBeGreaterThan(GB)
    expect(s.used).toBe(s.totalPhys - s.availPhys)
    expect(s.commitLimit).toBeGreaterThanOrEqual(s.commitTotal)
    if (s.installed) expect(s.installed).toBeGreaterThanOrEqual(s.totalPhys)
  })

  test('the process snapshot finds this test process by name with plausible memory', () => {
    const me = proc(process.pid)
    expect(me.name.toLowerCase()).toBe('node.exe')
    // On Windows, Node's rss is the working set; the snapshot was taken a moment apart.
    const rss = process.memoryUsage().rss
    expect(me.workingSet).toBeGreaterThan(rss * 0.7)
    expect(me.workingSet).toBeLessThan(rss * 1.3)
    expect(me.privateWs).toBeGreaterThan(0)
    expect(me.privateWs).toBeLessThanOrEqual(me.workingSet)
    expect(me.commit).toBeGreaterThan(0)
  })

  test('the snapshot includes the System process', () => {
    expect(win32.processes().some((p) => p.pid === 4)).toBe(true)
  })

  test('System cannot be trimmed by a standard user', () => {
    expect(win32.canTrim(4)).toBe(false)
  })

  test('reads the friendly description of node.exe', () => {
    const path = win32.imagePath(process.pid)
    expect(path?.toLowerCase().endsWith('node.exe')).toBe(true)
    expect(win32.fileDescription(path!)).toMatch(/node/i)
  })
})

describe.skipIf(!isWindows)('win32 actions on a process we own', () => {
  test('trimming moves memory out of the working set but leaves commit alone', async () => {
    const h = await hog()
    expect(await h.send('alloc 200')).toBe('ok 200')
    const before = proc(h.pid)
    expect(win32.trim(h.pid)).toEqual({ ok: true })
    const after = proc(h.pid)
    expect(after.workingSet).toBeLessThan(before.workingSet - 150 * MB)
    expect(after.commit).toBeGreaterThan(before.commit - 20 * MB)
  })

  test('an action aimed at a reused PID does nothing', async () => {
    const h = await hog()
    expect(await h.send('alloc 100')).toBe('ok 100')
    const before = proc(h.pid).workingSet
    const r = win32.trim(h.pid, 12345n)
    expect(r.ok).toBe(false)
    expect(proc(h.pid).workingSet).toBeGreaterThan(before * 0.8)
    expect(win32.trim(h.pid, proc(h.pid).createTime)).toEqual({ ok: true })
  })

  test('a ceiling keeps the resident set at or under the limit while the app keeps running', async () => {
    const h = await hog()
    expect(win32.setCeiling(h.pid, 100 * MB)).toEqual({ ok: true })
    expect(win32.readCeiling(h.pid)).toBe(100 * MB)
    expect(await h.send('alloc 300')).toBe('ok 300')
    expect(await h.send('touch')).toBe('ok')
    expect(proc(h.pid).workingSet).toBeLessThanOrEqual(100 * MB + 4 * MB)
    expect(win32.setCeiling(h.pid, null)).toEqual({ ok: true })
    expect(win32.readCeiling(h.pid)).toBeNull()
  })

  test('a cap makes allocations past the limit fail without killing the app', async () => {
    const h = await hog()
    const job = win32.openJob(`rr-test-${process.pid}-${Date.now()}`)
    try {
      expect(win32.assignToJob(job, h.pid)).toEqual({ ok: true })
      expect(win32.isInJob(job, h.pid)).toBe(true)
      const base = proc(h.pid).commit
      expect(win32.setJobCap(job, base + 200 * MB)).toEqual({ ok: true })
      expect(win32.readJobCap(job).cap).toBe(base + 200 * MB)
      expect(await h.send('alloc 100')).toBe('ok 100')
      expect(await h.send('alloc 200')).toMatch(/^fail/)
      // Still alive and responsive after the refusal.
      expect(await h.send('touch')).toBe('ok')
      expect(win32.setJobCap(job, null)).toEqual({ ok: true })
      expect(win32.readJobCap(job).cap).toBeNull()
      expect(await h.send('alloc 200')).toBe('ok 300')
    } finally {
      win32.closeJob(job)
    }
  })

  test('a cap holds only the processes R.R. chose: programs the app launches stay outside it', async () => {
    const h = await hog()
    const job = win32.openJob(`rr-test-kids-${process.pid}`)
    try {
      expect(win32.assignToJob(job, h.pid)).toEqual({ ok: true })
      expect(win32.setJobCap(job, 2 * GB)).toEqual({ ok: true })
      const reply = await h.send('spawn')
      const kid = Number(reply.split(' ')[1])
      expect(kid).toBeGreaterThan(0)
      expect(win32.isInJob(job, kid)).toBe(false)
      // Lifting the cap keeps that rule.
      expect(win32.setJobCap(job, null)).toEqual({ ok: true })
      const kid2 = Number((await h.send('spawn')).split(' ')[1])
      expect(win32.isInJob(job, kid2)).toBe(false)
      try {
        process.kill(kid)
        process.kill(kid2)
      } catch {
        /* already gone */
      }
    } finally {
      win32.closeJob(job)
    }
  })

  test('R.R. can list every process inside a cap, including ones the app placed there itself', async () => {
    const h = await hog()
    const job = win32.openJob(`rr-test-members-${process.pid}`)
    try {
      expect(win32.assignToJob(job, h.pid)).toEqual({ ok: true })
      expect(win32.jobProcessIds(job)).toEqual([h.pid])
      // Node adds its children to a job of its own, which Windows nests inside the cap.
      const kid = Number((await h.send('spawnjob')).split(' ')[1])
      expect(win32.jobProcessIds(job).sort()).toEqual([h.pid, kid].sort())
    } finally {
      win32.closeJob(job)
    }
  })

  test('a cap below what the app already committed counts that memory, and can end the app', async () => {
    const h = await hog()
    expect(await h.send('alloc 300')).toBe('ok 300')
    const job = win32.openJob(`rr-test-pre-${process.pid}-${Date.now()}`)
    try {
      expect(win32.assignToJob(job, h.pid)).toEqual({ ok: true })
      expect(win32.setJobCap(job, 200 * MB)).toEqual({ ok: true })
      // Already over the cap, so even a small allocation is refused. Node treats some refusals
      // as fatal and exits, which is exactly the risk the UI must warn about.
      expect(await h.send('alloc 20')).toMatch(/^(fail|exited)/)
    } finally {
      win32.closeJob(job)
    }
  })

  test('closing the last job handle orphans the cap: it stays on the app but cannot be reopened', async () => {
    const h = await hog()
    const key = `rr-test-reopen-${process.pid}-${Date.now()}`
    const first = win32.openJob(key)
    win32.assignToJob(first, h.pid)
    win32.setJobCap(first, proc(h.pid).commit + 100 * MB)
    win32.closeJob(first)
    const again = win32.openJob(key)
    try {
      // Windows drops the name with the last handle, so this is a new, empty job...
      expect(win32.isInJob(again, h.pid)).toBe(false)
      // ...while the original cap is still enforced on the running app.
      expect(await h.send('alloc 200')).toMatch(/^(fail|exited)/)
    } finally {
      win32.closeJob(again)
    }
  })
})
