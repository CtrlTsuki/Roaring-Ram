import { GB } from './format'
import type { AppAccess, AppGroup, ProcInfo } from './types'

export function appKey(name: string): string {
  return name.toLowerCase()
}

/**
 * Groups processes into apps by executable name. Figures are summed per app; note that
 * summing full working sets double-counts shared pages, which is why the list ranks by
 * private working set.
 */
export function groupProcesses(procs: ProcInfo[]): AppGroup[] {
  const byKey = new Map<string, AppGroup & { trimmable: number }>()
  for (const p of procs) {
    if (p.pid === 0) continue
    const key = appKey(p.name)
    let g = byKey.get(key)
    if (!g) {
      g = {
        key,
        name: p.name,
        description: p.description,
        pids: [],
        processCount: 0,
        privateWs: 0,
        workingSet: 0,
        commit: 0,
        access: 'none',
        hasWindows: false,
        critical: false,
        trimmable: 0
      }
      byKey.set(key, g)
    }
    g.pids.push(p.pid)
    g.processCount++
    g.privateWs += p.privateWs
    g.workingSet += p.workingSet
    g.commit += p.commit
    if (p.access === 'trim') g.trimmable++
    if (p.windows) g.hasWindows = true
    if (p.critical) g.critical = true
    if (!g.description && p.description) g.description = p.description
  }

  const apps: AppGroup[] = []
  for (const { trimmable, ...g } of byKey.values()) {
    const access: AppAccess = trimmable === 0 ? 'none' : trimmable === g.processCount ? 'full' : 'partial'
    apps.push({ ...g, access })
  }
  return apps.sort((a, b) => b.privateWs - a.privateWs)
}

/** A Titan holds at least 10% of usable RAM and at least 1 GB of it. */
export function isTitan(privateWs: number, totalPhys: number): boolean {
  return privateWs >= GB && privateWs >= totalPhys * 0.1
}
