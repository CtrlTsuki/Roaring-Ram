import type { UsageAverage, UsageSample } from './types'

const COMPLETE_SLACK_MS = 5_000

/** Rolling record of system RAM use. Samples arrive every ~2 s; the window is five minutes. */
export class UsageHistory {
  private readonly items: UsageSample[] = []

  constructor(private readonly windowMs: number) {}

  add(sample: UsageSample): void {
    this.items.push(sample)
    this.prune(sample.t)
  }

  samples(now: number): UsageSample[] {
    this.prune(now)
    return this.items.slice()
  }

  average(now: number): UsageAverage | null {
    this.prune(now)
    const n = this.items.length
    if (n === 0) return null
    // Weight each sample by how long it stood, so faster sampling (window visible, or right after
    // an action) does not tilt the average.
    let weighted = 0
    let fractionWeighted = 0
    let totalWeight = 0
    let peak = 0
    for (let i = 0; i < n; i++) {
      const s = this.items[i]
      const span = i < n - 1 ? this.items[i + 1].t - s.t : n > 1 ? s.t - this.items[i - 1].t : 1
      const weight = Math.max(span, 1)
      weighted += s.used * weight
      fractionWeighted += (s.used / s.total) * weight
      totalWeight += weight
      if (s.used > peak) peak = s.used
    }
    const coveredMs = now - this.items[0].t
    return {
      usedBytes: weighted / totalWeight,
      fraction: fractionWeighted / totalWeight,
      peakBytes: peak,
      coveredMs,
      // Samples land every few seconds, so the oldest one in the window is never exactly five
      // minutes old. Within one sampling gap of it counts as a full window.
      complete: coveredMs >= this.windowMs - COMPLETE_SLACK_MS
    }
  }

  private prune(now: number): void {
    const cutoff = now - this.windowMs
    while (this.items.length && this.items[0].t < cutoff) this.items.shift()
  }
}
