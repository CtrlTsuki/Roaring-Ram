import { describe, expect, test } from 'vitest'
import { UsageHistory } from '../src/shared/history'
import { GB } from '../src/shared/format'

const total = 16 * GB

describe('UsageHistory', () => {
  test('averages the samples inside the window', () => {
    const h = new UsageHistory(5 * 60_000)
    h.add({ t: 0, used: 8 * GB, total })
    h.add({ t: 2_000, used: 10 * GB, total })
    h.add({ t: 4_000, used: 12 * GB, total })
    const avg = h.average(4_000)
    expect(avg?.usedBytes).toBe(10 * GB)
    expect(avg?.fraction).toBeCloseTo(10 / 16)
  })

  test('drops samples older than five minutes', () => {
    const h = new UsageHistory(5 * 60_000)
    h.add({ t: 0, used: 15 * GB, total })
    h.add({ t: 301_000, used: 9 * GB, total })
    h.add({ t: 303_000, used: 11 * GB, total })
    expect(h.average(303_000)?.usedBytes).toBe(10 * GB)
    expect(h.samples(303_000)).toHaveLength(2)
  })

  test('reports how much of the window it actually covers', () => {
    const h = new UsageHistory(5 * 60_000)
    h.add({ t: 10_000, used: 8 * GB, total })
    h.add({ t: 70_000, used: 8 * GB, total })
    const avg = h.average(70_000)
    expect(avg?.coveredMs).toBe(60_000)
    expect(avg?.complete).toBe(false)
  })

  test('marks the window complete once five minutes are covered', () => {
    const h = new UsageHistory(5 * 60_000)
    for (let t = 0; t <= 300_000; t += 2_000) h.add({ t, used: 8 * GB, total })
    expect(h.average(300_000)?.complete).toBe(true)
  })

  test('marks the window complete with real, uneven sample timing', () => {
    const h = new UsageHistory(5 * 60_000)
    let last = 0
    for (let t = 0; t <= 301_000; t += 2_000 + (t % 7)) {
      h.add({ t, used: 8 * GB, total })
      last = t
    }
    expect(h.average(last)?.complete).toBe(true)
  })

  test('returns null before any sample exists', () => {
    expect(new UsageHistory(60_000).average(0)).toBeNull()
  })

  test('reports the peak inside the window', () => {
    const h = new UsageHistory(5 * 60_000)
    h.add({ t: 0, used: 8 * GB, total })
    h.add({ t: 2_000, used: 13 * GB, total })
    h.add({ t: 4_000, used: 9 * GB, total })
    expect(h.average(4_000)?.peakBytes).toBe(13 * GB)
  })
})
