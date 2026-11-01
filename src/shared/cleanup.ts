import { groupProcesses } from './apps'
import { formatDelta } from './format'
import type { AppGroup, ProcInfo } from './types'

export type SkipReason = 'windows' | 'denied' | 'self'

export interface RoaringPlan {
  /** Processes whose working sets will be trimmed. */
  trim: ProcInfo[]
  skipped: { reason: SkipReason; count: number; names: string[] }[]
  /** Apps with windows the person may choose to ask to close. None are chosen by default. */
  closeCandidates: AppGroup[]
}

export function planRoaring(procs: ProcInfo[], selfPids: Set<number>): RoaringPlan {
  const trim: ProcInfo[] = []
  const skipped = new Map<SkipReason, { count: number; names: Set<string> }>()
  const skip = (reason: SkipReason, p: ProcInfo) => {
    const s = skipped.get(reason) ?? { count: 0, names: new Set<string>() }
    s.count++
    s.names.add(p.name)
    skipped.set(reason, s)
  }
  for (const p of procs) {
    if (p.pid === 0) continue
    if (selfPids.has(p.pid)) skip('self', p)
    else if (p.critical) skip('windows', p)
    else if (p.access !== 'trim') skip('denied', p)
    else trim.push(p)
  }
  const closeCandidates = groupProcesses(trim).filter((a) => a.hasWindows)
  return {
    trim,
    skipped: [...skipped].map(([reason, s]) => ({ reason, count: s.count, names: [...s.names].sort() })),
    closeCandidates
  }
}

export function summarizeChange(before: number, after: number): { delta: number; text: string; rose: boolean } {
  const delta = after - before
  return { delta, text: formatDelta(delta), rose: delta > 0 && formatDelta(delta) !== 'no change' }
}
