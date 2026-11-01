// The Waterline is the system-wide RAM target. Windows has no API to cap total system memory,
// so the target is something R.R. measures against and works toward, never something it enforces.
import { GB, formatBytes } from './format'
import type { Check } from './seals'
import type { ProcInfo, SystemMemory } from './types'

export type WaterlineStateName = 'met' | 'above' | 'unreachable'

export interface WaterlineState {
  state: WaterlineStateName
  /** used − target. Negative means headroom under the target. */
  gap: number
  message: string
}

/**
 * Memory R.R. cannot influence right now: kernel pools plus the private working sets of
 * Windows components and processes Windows will not let R.R. open. An estimate: drivers and
 * hardware-reserved memory are not counted.
 */
export function untouchableFloor(sys: SystemMemory, procs: ProcInfo[]): number {
  let floor = sys.kernelPaged + sys.kernelNonpaged
  for (const p of procs) {
    if (p.pid === 0) continue
    if (p.critical || p.access === 'denied') floor += p.privateWs
  }
  return floor
}

export function assessWaterline(target: number, used: number, floor: number): WaterlineState {
  const gap = used - target
  if (gap <= 0) {
    return { state: 'met', gap, message: `${formatBytes(-gap)} under your waterline.` }
  }
  if (target < floor) {
    return {
      state: 'unreachable',
      gap,
      message: `Windows, drivers and processes R.R. can't touch are holding about ${formatBytes(floor)}, which is above your waterline. Reaching it would mean closing those, and R.R. won't.`
    }
  }
  return {
    state: 'above',
    gap,
    message: `${formatBytes(gap)} above your waterline. Closing apps you aren't using helps most; The Roaring can give back some memory for a while.`
  }
}

export function checkWaterline(target: number, totalPhys: number): Check {
  const warnings: string[] = []
  if (!(target > 0)) return { error: 'Enter a target above zero.', warnings }
  if (target >= totalPhys) return { error: `Set it below your usable RAM (${formatBytes(totalPhys)}).`, warnings }
  if (target < Math.max(3 * GB, totalPhys * 0.25)) {
    warnings.push('Windows and its services usually need a few GB on their own, so a target this low is unlikely to hold.')
  }
  return { warnings }
}
