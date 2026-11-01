import { describe, expect, test } from 'vitest'
import { planRoaring, summarizeChange } from '../src/shared/cleanup'
import { GB, MB } from '../src/shared/format'
import type { ProcInfo } from '../src/shared/types'

const p = (pid: number, name: string, over: Partial<ProcInfo> = {}): ProcInfo => ({
  pid,
  parentPid: 0,
  name,
  privateWs: 200 * MB,
  workingSet: 250 * MB,
  commit: 300 * MB,
  access: 'trim',
  windows: false,
  critical: false,
  ...over
})

describe('planRoaring', () => {
  const procs = [
    p(4, 'System', { critical: true, access: 'denied' }),
    p(600, 'csrss.exe', { critical: true, access: 'trim' }),
    p(800, 'MsMpEng.exe', { access: 'denied' }),
    p(1000, 'chrome.exe', { windows: true }),
    p(1001, 'chrome.exe'),
    p(2000, 'R.R..exe'),
    p(3000, 'code.exe', { windows: true })
  ]

  test('trims only processes Windows lets R.R. act on', () => {
    const plan = planRoaring(procs, new Set([2000]))
    expect(plan.trim.map((x) => x.pid)).toEqual([1000, 1001, 3000])
  })

  test('never touches Windows components, even when access is granted', () => {
    const plan = planRoaring(procs, new Set([2000]))
    expect(plan.trim.some((x) => x.critical)).toBe(false)
    expect(plan.skipped.find((s) => s.reason === 'windows')?.count).toBe(2)
  })

  test('lists denied processes so the summary can explain them', () => {
    const plan = planRoaring(procs, new Set([2000]))
    expect(plan.skipped.find((s) => s.reason === 'denied')?.count).toBe(1)
  })

  test('leaves R.R. itself alone', () => {
    const plan = planRoaring(procs, new Set([2000]))
    expect(plan.trim.some((x) => x.pid === 2000)).toBe(false)
  })

  test('offers apps with windows as close candidates, none chosen by default', () => {
    const plan = planRoaring(procs, new Set([2000]))
    expect(plan.closeCandidates.map((a) => a.key)).toEqual(['chrome.exe', 'code.exe'])
  })
})

describe('summarizeChange', () => {
  test('reports memory given back as a negative change', () => {
    const s = summarizeChange(12 * GB, 10.5 * GB)
    expect(s.delta).toBe(-1.5 * GB)
    expect(s.text).toBe('−1.5 GB')
  })

  test('says plainly when usage rose instead', () => {
    const s = summarizeChange(10 * GB, 10.4 * GB)
    expect(s.text).toBe('+410 MB')
    expect(s.rose).toBe(true)
  })
})
