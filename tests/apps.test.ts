import { describe, expect, test } from 'vitest'
import { groupProcesses, isTitan, appKey } from '../src/shared/apps'
import { GB, MB } from '../src/shared/format'
import type { ProcInfo } from '../src/shared/types'

function proc(pid: number, name: string, privateWs: number, extra: Partial<ProcInfo> = {}): ProcInfo {
  return {
    pid,
    parentPid: 0,
    name,
    privateWs,
    workingSet: privateWs + 50 * MB,
    commit: privateWs + 100 * MB,
    access: 'trim',
    windows: false,
    critical: false,
    ...extra
  }
}

describe('appKey', () => {
  test('ignores case so chrome.exe and Chrome.exe are one app', () => {
    expect(appKey('Chrome.exe')).toBe(appKey('chrome.exe'))
  })
})

describe('groupProcesses', () => {
  test('sums memory across processes of the same app', () => {
    const apps = groupProcesses([
      proc(10, 'chrome.exe', 400 * MB),
      proc(11, 'chrome.exe', 600 * MB),
      proc(20, 'code.exe', 300 * MB)
    ])
    const chrome = apps.find((a) => a.key === 'chrome.exe')!
    expect(chrome.privateWs).toBe(1000 * MB)
    expect(chrome.pids).toEqual([10, 11])
    expect(chrome.processCount).toBe(2)
  })

  test('sorts apps by private working set, largest first', () => {
    const apps = groupProcesses([proc(1, 'a.exe', 100 * MB), proc(2, 'b.exe', 900 * MB), proc(3, 'c.exe', 500 * MB)])
    expect(apps.map((a) => a.key)).toEqual(['b.exe', 'c.exe', 'a.exe'])
  })

  test('summarises access: all, some or none of the processes can be trimmed', () => {
    const apps = groupProcesses([
      proc(1, 'mixed.exe', 100 * MB, { access: 'trim' }),
      proc(2, 'mixed.exe', 100 * MB, { access: 'denied' }),
      proc(3, 'locked.exe', 100 * MB, { access: 'denied' }),
      proc(4, 'open.exe', 100 * MB, { access: 'trim' })
    ])
    expect(apps.find((a) => a.key === 'mixed.exe')!.access).toBe('partial')
    expect(apps.find((a) => a.key === 'locked.exe')!.access).toBe('none')
    expect(apps.find((a) => a.key === 'open.exe')!.access).toBe('full')
  })

  test('keeps Windows-critical processes flagged as critical', () => {
    const apps = groupProcesses([proc(4, 'System', 2 * MB, { critical: true, access: 'denied' })])
    expect(apps[0].critical).toBe(true)
  })

  test('skips the idle pseudo-process', () => {
    const apps = groupProcesses([proc(0, 'Idle', 0, { critical: true })])
    expect(apps).toHaveLength(0)
  })

  test('marks an app as having windows when any of its processes has one', () => {
    const apps = groupProcesses([proc(1, 'x.exe', 1 * MB, { windows: false }), proc(2, 'x.exe', 1 * MB, { windows: true })])
    expect(apps[0].hasWindows).toBe(true)
  })
})

describe('isTitan', () => {
  test('an app holding at least 10% of RAM and at least 1 GB is a Titan', () => {
    expect(isTitan(1.7 * GB, 16 * GB)).toBe(true)
  })

  test('a large share of a tiny machine below 1 GB is not a Titan', () => {
    expect(isTitan(900 * MB, 4 * GB)).toBe(false)
  })

  test('1 GB on a 64 GB machine is not a Titan', () => {
    expect(isTitan(1.2 * GB, 64 * GB)).toBe(false)
  })
})
