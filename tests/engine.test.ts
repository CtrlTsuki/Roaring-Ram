// The engine's decisions, against a fake operating system, so the system-wide actions can be
// checked without trimming or limiting anything on the machine running the tests.
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { Engine } from '../src/main/engine'
import type { ActionResult, Platform, RawProc } from '../src/main/platform'
import { Store } from '../src/main/store'
import { GB, MB } from '../src/shared/format'

const OK: ActionResult = { ok: true }
const DENIED: ActionResult = { ok: false, denied: true, code: 5, message: 'Windows denied access.' }

function fakePlatform(procs: RawProc[], opts: { denied?: number[]; windows?: number[]; jobMembers?: number[] } = {}) {
  const calls = { trim: [] as number[], close: [] as unknown[][], cap: [] as (number | null)[], assign: [] as number[], ceiling: [] as [number, number | null][] }
  let used = 12 * GB
  const p: Platform = {
    caps: { platform: 'win32', platformName: 'Windows', monitorProcesses: true, trim: true, ceiling: true, cap: true, askToClose: true, notes: [] },
    systemMemory: () => ({ totalPhys: 16 * GB, installed: 16 * GB, availPhys: 16 * GB - used, used, commitTotal: 20 * GB, commitLimit: 30 * GB, cache: 2 * GB, kernelPaged: 300 * MB, kernelNonpaged: 200 * MB }),
    processes: () => procs,
    canTrim: (pid) => !(opts.denied ?? []).includes(pid),
    describe: () => ({ path: null, description: null }),
    windowOwners: () => new Map((opts.windows ?? []).map((pid) => [pid, [`hwnd-${pid}`]])),
    trim: (pid) => {
      calls.trim.push(pid)
      used -= 100 * MB
      return (opts.denied ?? []).includes(pid) ? DENIED : OK
    },
    setCeiling: (pid, bytes) => (calls.ceiling.push([pid, bytes]), OK),
    readCeiling: () => null,
    openJob: () => 'job',
    jobMembers: () => opts.jobMembers ?? [],
    closeJob: () => {},
    setJobCap: (_job, bytes) => (calls.cap.push(bytes), OK),
    assignToJob: (_job, pid) => (calls.assign.push(pid), (opts.denied ?? []).includes(pid) ? DENIED : OK),
    requestClose: (w) => (calls.close.push(w), w.length)
  }
  return { platform: p, calls }
}

const proc = (pid: number, name: string, mb: number, commitMb = mb + 50): RawProc => ({
  pid,
  parentPid: 1,
  name,
  privateWs: mb * MB,
  workingSet: (mb + 20) * MB,
  commit: commitMb * MB,
  createTime: `t${pid}`
})

let dir: string
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rr-engine-'))
  vi.useFakeTimers()
})
afterEach(() => {
  vi.useRealTimers()
})

function setup(procs: RawProc[], opts?: { denied?: number[]; windows?: number[]; self?: number[]; jobMembers?: number[] }) {
  const { platform, calls } = fakePlatform(procs, opts)
  const store = new Store(path.join(dir, 'state.json'))
  const engine = new Engine(platform, store, () => new Set(opts?.self ?? []))
  engine.tick()
  return { engine, store, calls }
}

const procs = [
  proc(4, 'System', 1),
  proc(600, 'csrss.exe', 5),
  proc(700, 'svchost.exe', 80),
  proc(1000, 'chrome.exe', 900),
  proc(1001, 'chrome.exe', 400),
  proc(2000, 'code.exe', 600),
  proc(3000, 'elevated.exe', 300),
  proc(4000, 'R.R..exe', 150)
]

describe('The Roaring', () => {
  test('trims only reachable, non-Windows processes and never R.R. itself', async () => {
    const { engine, calls } = setup(procs, { denied: [3000], self: [4000] })
    const run = engine.runRoaring({ close: [] })
    await vi.advanceTimersByTimeAsync(2000)
    const r = await run
    expect(r.ok).toBe(true)
    expect(calls.trim.sort()).toEqual([1000, 1001, 2000])
  })

  test('asks only the apps the person chose to close', async () => {
    const { engine, calls } = setup(procs, { windows: [1000, 2000], self: [4000] })
    const run = engine.runRoaring({ close: ['code.exe'] })
    await vi.advanceTimersByTimeAsync(2000)
    await run
    expect(calls.close).toEqual([['hwnd-2000']])
  })

  test('records the measured change and what it could not do', async () => {
    const { engine } = setup(procs, { denied: [3000], self: [4000] })
    const run = engine.runRoaring({ close: [] })
    await vi.advanceTimersByTimeAsync(2000)
    const { echo } = await run
    expect(echo!.change!.after).toBeLessThan(echo!.change!.before)
    expect(echo!.limits.join(' ')).toMatch(/denied access to 1 processes/)
    expect(echo!.limits.join(' ')).toMatch(/Windows components/)
  })

  test('fills in how much came back 30 seconds later', async () => {
    const { engine, store } = setup(procs)
    const run = engine.runRoaring({ close: [] })
    await vi.advanceTimersByTimeAsync(2000)
    const { echo } = await run
    await vi.advanceTimersByTimeAsync(31_000)
    expect(store.state.echoes.find((e) => e.id === echo!.id)!.rebound).toBeDefined()
  })
})

describe('Titan', () => {
  test('explains that no supported action exists for an app Windows denies', async () => {
    const { engine, calls } = setup(procs, { denied: [3000] })
    const r = await engine.runTitan('elevated.exe')
    expect(calls.trim).toEqual([])
    expect(r.echo!.lines[0]).toMatch(/No supported action/)
    expect(r.echo!.limits[0]).toMatch(/denied/)
  })

  test('never acts on a Windows component', async () => {
    const { engine, calls } = setup(procs)
    await engine.runTitan('csrss.exe')
    expect(calls.trim).toEqual([])
  })
})

describe('seals', () => {
  test('refuses a cap below current commit until the risk is accepted', () => {
    const { engine } = setup(procs)
    expect(engine.saveSeal({ key: 'chrome.exe', mode: 'cap', bytes: 1 * GB, acceptRisk: false }).error).toBe('risk')
    expect(engine.saveSeal({ key: 'chrome.exe', mode: 'cap', bytes: 1 * GB, acceptRisk: true }).ok).toBe(true)
  })

  test('a cap puts every process of the app in the job and reports it enforced', () => {
    const { engine, calls } = setup(procs)
    const r = engine.saveSeal({ key: 'chrome.exe', mode: 'cap', bytes: 3 * GB, acceptRisk: false })
    expect(calls.assign.sort()).toEqual([1000, 1001])
    expect(calls.cap).toContain(3 * GB)
    expect(r.echo!.lines[0]).toMatch(/Enforced by Windows/)
  })

  test('reports a cap as not enforceable when Windows refuses every process', () => {
    const { engine } = setup([proc(5000, 'locked.exe', 300)], { denied: [5000] })
    // The probe said "denied", so the check refuses before anything is attempted.
    expect(engine.saveSeal({ key: 'locked.exe', mode: 'cap', bytes: 1 * GB, acceptRisk: false }).error).toMatch(/denied/i)
  })

  test('removing a cap lifts the limit on the job', () => {
    const { engine, calls } = setup(procs)
    engine.saveSeal({ key: 'code.exe', mode: 'cap', bytes: 2 * GB, acceptRisk: false })
    engine.removeSeal('code.exe')
    expect(calls.cap.at(-1)).toBeNull()
  })

  test('a watch seal never touches the process', () => {
    const { engine, calls } = setup(procs)
    engine.saveSeal({ key: 'code.exe', mode: 'watch', bytes: 100 * MB, acceptRisk: false })
    engine.tick()
    expect(calls.assign).toEqual([])
    expect(calls.ceiling).toEqual([])
  })

  test('a watch seal logs once when the app goes over, not every tick', () => {
    const { engine, store } = setup(procs)
    engine.saveSeal({ key: 'code.exe', mode: 'watch', bytes: 100 * MB, acceptRisk: false })
    engine.tick()
    engine.tick()
    expect(store.state.echoes.filter((e) => e.kind === 'watch')).toHaveLength(1)
  })

  test('a ceiling is applied per process, never divided between them', () => {
    const { engine, calls } = setup(procs)
    engine.saveSeal({ key: 'chrome.exe', mode: 'ceiling', bytes: 512 * MB, acceptRisk: false })
    expect(calls.ceiling.sort()).toEqual([
      [1000, 512 * MB],
      [1001, 512 * MB]
    ])
  })
})

describe('editing seals', () => {
  test('changing a ceiling size reaches processes that are already running', () => {
    const { engine, calls } = setup(procs)
    engine.saveSeal({ key: 'chrome.exe', mode: 'ceiling', bytes: 512 * MB, acceptRisk: false })
    engine.saveSeal({ key: 'chrome.exe', mode: 'ceiling', bytes: 1 * GB, acceptRisk: false })
    expect(calls.ceiling.filter(([, b]) => b === 1 * GB).map(([pid]) => pid).sort()).toEqual([1000, 1001])
  })

  test('pausing and resuming a seal are both recorded in Echoes', () => {
    const { engine, store } = setup(procs)
    engine.saveSeal({ key: 'code.exe', mode: 'cap', bytes: 2 * GB, acceptRisk: false })
    engine.setSealEnabled('code.exe', false)
    engine.setSealEnabled('code.exe', true)
    expect(store.state.echoes.slice(0, 2).map((e) => e.title)).toEqual(['Seal resumed on code.exe', 'Seal paused on code.exe'])
  })

  test('editing a seal for an app that is not running still refuses Windows components and tiny sizes', () => {
    const { engine, store } = setup(procs)
    store.state.seals.push({ key: 'gone.exe', name: 'gone.exe', mode: 'watch', bytes: GB, enabled: true, createdAt: 0 })
    expect(engine.saveSeal({ key: 'gone.exe', mode: 'watch', bytes: 10 * MB, acceptRisk: false }).ok).toBe(false)
    store.state.seals.push({ key: 'csrss.exe', name: 'csrss.exe', mode: 'watch', bytes: GB, enabled: true, createdAt: 0 })
    expect(engine.saveSeal({ key: 'svchost.exe', mode: 'cap', bytes: GB, acceptRisk: true }).ok).toBe(false)
  })
})

describe('what a cap really holds', () => {
  test('names other programs the app placed in the cap, and counts their memory', () => {
    const extra = [...procs, proc(9000, 'helper.exe', 700, 900)]
    const { engine } = setup(extra, { jobMembers: [2000, 9000] })
    engine.saveSeal({ key: 'code.exe', mode: 'cap', bytes: 4 * GB, acceptRisk: false })
    engine.tick()
    const row = engine.snapshot().apps.find((a) => a.key === 'code.exe')!
    expect(row.seal!.also).toEqual(['helper.exe'])
    expect(row.seal!.capCommit).toBe((650 + 900) * MB)
    expect(row.seal!.state.detail).toMatch(/helper\.exe/)
  })
})

describe('partly enforced seals', () => {
  test('flag the app in Echoes when it goes over, as they promise', () => {
    const { engine, store } = setup(procs, { denied: [1001] })
    // chrome.exe: 1000 can be capped, 1001 is refused -> partly enforced.
    engine.saveSeal({ key: 'chrome.exe', mode: 'cap', bytes: 1 * GB, acceptRisk: true })
    engine.tick()
    expect(store.state.echoes.some((e) => e.kind === 'watch' && /chrome/.test(e.title))).toBe(true)
  })
})

describe('quitting', () => {
  test('ceilings are lifted when R.R. quits, since nothing could change them afterwards', () => {
    const { engine, calls } = setup(procs)
    engine.saveSeal({ key: 'chrome.exe', mode: 'ceiling', bytes: 512 * MB, acceptRisk: false })
    engine.prepareQuit(false)
    expect(calls.ceiling.filter(([, b]) => b === null).map(([pid]) => pid).sort()).toEqual([1000, 1001])
  })

  test('lists enforced caps so the person can decide, and remembers them if kept', () => {
    const { engine, store } = setup(procs)
    engine.saveSeal({ key: 'code.exe', mode: 'cap', bytes: 2 * GB, acceptRisk: false })
    expect(engine.quitPrompt().caps).toEqual([{ name: 'code.exe', bytes: 2 * GB }])
    engine.prepareQuit(false)
    expect(store.state.lockedCaps).toEqual([{ key: 'code.exe', pid: 2000, createTime: 't2000', bytes: 2 * GB }])
  })

  test('lifting caps on quit clears the job limit', () => {
    const { engine, calls } = setup(procs)
    engine.saveSeal({ key: 'code.exe', mode: 'cap', bytes: 2 * GB, acceptRisk: false })
    engine.prepareQuit(true)
    expect(calls.cap.at(-1)).toBeNull()
  })
})
