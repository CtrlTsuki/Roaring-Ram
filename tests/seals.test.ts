import { describe, expect, test } from 'vitest'
import { sealState, checkSeal, isOverSeal, sealMetric } from '../src/shared/seals'
import { GB, MB } from '../src/shared/format'
import type { Seal } from '../src/shared/seals'
import type { AppGroup, ProcInfo } from '../src/shared/types'

const seal = (over: Partial<Seal> = {}): Seal => ({
  key: 'chrome.exe',
  name: 'chrome.exe',
  mode: 'cap',
  bytes: 4 * GB,
  enabled: true,
  createdAt: 0,
  ...over
})

const app = (over: Partial<AppGroup> = {}): AppGroup => ({
  key: 'chrome.exe',
  name: 'chrome.exe',
  pids: [1, 2],
  processCount: 2,
  privateWs: 2 * GB,
  workingSet: 2.5 * GB,
  commit: 3 * GB,
  access: 'full',
  hasWindows: true,
  critical: false,
  ...over
})

describe('sealState', () => {
  test('a paused seal says so, whatever Windows did before', () => {
    expect(sealState(seal({ enabled: false }), { matched: 2, applied: 2, denied: 0, failed: 0 }).state).toBe('paused')
  })

  test('a watch seal is never described as enforced', () => {
    const s = sealState(seal({ mode: 'watch' }), { matched: 2, applied: 2, denied: 0, failed: 0 })
    expect(s.state).toBe('watching')
    expect(s.label).not.toMatch(/enforced/i)
  })

  test('enforced only when Windows accepted every running process', () => {
    expect(sealState(seal(), { matched: 3, applied: 3, denied: 0, failed: 0 }).state).toBe('enforced')
  })

  test('partial when Windows accepted some processes and refused others', () => {
    const s = sealState(seal(), { matched: 3, applied: 1, denied: 2, failed: 0 })
    expect(s.state).toBe('partial')
    expect(s.detail).toMatch(/1 of 3/)
  })

  test('unsupported when Windows refused every process', () => {
    expect(sealState(seal(), { matched: 2, applied: 0, denied: 2, failed: 0 }).state).toBe('unsupported')
  })

  test('waiting when the app is not running', () => {
    expect(sealState(seal(), { matched: 0, applied: 0, denied: 0, failed: 0 }).state).toBe('waiting')
  })
})

describe('sealMetric', () => {
  test('a cap counts committed memory, a ceiling counts resident memory', () => {
    expect(sealMetric('cap')).toBe('commit')
    expect(sealMetric('ceiling')).toBe('workingSet')
    expect(sealMetric('watch')).toBe('privateWs')
  })
})

describe('isOverSeal', () => {
  const procs: ProcInfo[] = [
    { pid: 1, parentPid: 0, name: 'chrome.exe', privateWs: GB, workingSet: 1.2 * GB, commit: 1.5 * GB, access: 'trim', windows: true, critical: false },
    { pid: 2, parentPid: 1, name: 'chrome.exe', privateWs: GB, workingSet: 1.3 * GB, commit: 1.5 * GB, access: 'trim', windows: false, critical: false }
  ]

  test('watch compares the app total private working set', () => {
    expect(isOverSeal(seal({ mode: 'watch', bytes: 1.5 * GB }), app(), procs)).toBe(true)
    expect(isOverSeal(seal({ mode: 'watch', bytes: 3 * GB }), app(), procs)).toBe(false)
  })

  test('cap compares the app total commit', () => {
    expect(isOverSeal(seal({ mode: 'cap', bytes: 2.5 * GB }), app(), procs)).toBe(true)
  })

  test('ceiling compares each process on its own, never a share of the total', () => {
    expect(isOverSeal(seal({ mode: 'ceiling', bytes: 1.25 * GB }), app(), procs)).toBe(true)
    expect(isOverSeal(seal({ mode: 'ceiling', bytes: 1.4 * GB }), app(), procs)).toBe(false)
  })
})

describe('checkSeal', () => {
  test('refuses values under 64 MB', () => {
    expect(checkSeal('cap', 32 * MB, app(), 16 * GB).error).toBeTruthy()
  })

  test('warns that a cap below current commit makes allocations fail', () => {
    const r = checkSeal('cap', 2 * GB, app({ commit: 3 * GB }), 16 * GB)
    expect(r.error).toBeUndefined()
    expect(r.warnings.join(' ')).toMatch(/refuse/i)
  })

  test('warns that a ceiling below current use causes paging', () => {
    const r = checkSeal('ceiling', 512 * MB, app(), 16 * GB, 1.3 * GB)
    expect(r.warnings.join(' ')).toMatch(/page/i)
  })

  test('warns when the value is above usable RAM and can never trigger', () => {
    const r = checkSeal('watch', 20 * GB, app(), 16 * GB)
    expect(r.warnings.join(' ')).toMatch(/never/i)
  })

  test('refuses an enforced seal on an app Windows will not let R.R. touch', () => {
    expect(checkSeal('cap', 2 * GB, app({ access: 'none' }), 16 * GB).error).toMatch(/denied|access/i)
    expect(checkSeal('watch', 2 * GB, app({ access: 'none' }), 16 * GB).error).toBeUndefined()
  })

  test('refuses an enforced seal on the Windows shell, which launches every other app', () => {
    expect(checkSeal('cap', 2 * GB, app({ key: 'explorer.exe', name: 'explorer.exe' }), 16 * GB).error).toMatch(/shell/i)
    expect(checkSeal('watch', 2 * GB, app({ key: 'explorer.exe', name: 'explorer.exe' }), 16 * GB).error).toBeUndefined()
  })

  test('refuses an enforced seal on a Windows component', () => {
    expect(checkSeal('ceiling', 2 * GB, app({ critical: true }), 16 * GB).error).toBeTruthy()
  })
})
