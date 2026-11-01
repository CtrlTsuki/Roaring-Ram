import { describe, expect, test } from 'vitest'
import { assessWaterline, checkWaterline, untouchableFloor } from '../src/shared/waterline'
import { GB, MB } from '../src/shared/format'
import type { ProcInfo, SystemMemory } from '../src/shared/types'

const sys: SystemMemory = {
  totalPhys: 16 * GB,
  installed: 16 * GB,
  availPhys: 4 * GB,
  used: 12 * GB,
  commitTotal: 20 * GB,
  commitLimit: 30 * GB,
  cache: 3 * GB,
  kernelPaged: 600 * MB,
  kernelNonpaged: 400 * MB
}

describe('assessWaterline', () => {
  test('met when usage is at or under the target', () => {
    const r = assessWaterline(13 * GB, sys.used, 3 * GB)
    expect(r.state).toBe('met')
    expect(r.gap).toBe(-1 * GB)
  })

  test('above when usage exceeds a reachable target', () => {
    const r = assessWaterline(10 * GB, sys.used, 3 * GB)
    expect(r.state).toBe('above')
    expect(r.gap).toBe(2 * GB)
  })

  test('unreachable when the target sits below what R.R. cannot touch', () => {
    const r = assessWaterline(2 * GB, sys.used, 3 * GB)
    expect(r.state).toBe('unreachable')
    expect(r.message).toMatch(/can.t/i)
  })
})

describe('untouchableFloor', () => {
  test('counts kernel memory plus processes R.R. may not act on', () => {
    const procs: ProcInfo[] = [
      { pid: 4, parentPid: 0, name: 'System', privateWs: 100 * MB, workingSet: 100 * MB, commit: 0, access: 'denied', windows: false, critical: true },
      { pid: 900, parentPid: 1, name: 'svchost.exe', privateWs: 500 * MB, workingSet: 600 * MB, commit: 600 * MB, access: 'denied', windows: false, critical: false },
      { pid: 1000, parentPid: 1, name: 'chrome.exe', privateWs: 2 * GB, workingSet: 2 * GB, commit: 2 * GB, access: 'trim', windows: true, critical: false }
    ]
    expect(untouchableFloor(sys, procs)).toBe(600 * MB + 400 * MB + 100 * MB + 500 * MB)
  })

  test('counts a Windows component even if access were granted', () => {
    const procs: ProcInfo[] = [
      { pid: 700, parentPid: 1, name: 'csrss.exe', privateWs: 10 * MB, workingSet: 10 * MB, commit: 0, access: 'trim', windows: false, critical: true }
    ]
    expect(untouchableFloor(sys, procs)).toBe(1000 * MB + 10 * MB)
  })
})

describe('checkWaterline', () => {
  test('refuses a target at or above usable RAM', () => {
    expect(checkWaterline(16 * GB, sys.totalPhys).error).toBeTruthy()
  })

  test('refuses an empty target', () => {
    expect(checkWaterline(0, sys.totalPhys).error).toBeTruthy()
  })

  test('warns that a very low target is unlikely to hold', () => {
    const r = checkWaterline(2 * GB, sys.totalPhys)
    expect(r.error).toBeUndefined()
    expect(r.warnings.length).toBeGreaterThan(0)
  })

  test('accepts 10 GB on a 16 GB machine without warnings', () => {
    expect(checkWaterline(10 * GB, sys.totalPhys)).toEqual({ warnings: [] })
  })
})
