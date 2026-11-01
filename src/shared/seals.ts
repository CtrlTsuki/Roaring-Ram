// Seals are R.R.'s per-app memory limits. Three kinds, because Windows offers two real
// mechanisms and people also want a limit that only watches:
//   watch   — R.R. compares and flags. Nothing is enforced.
//   ceiling — hard working-set maximum per process (SetProcessWorkingSetSizeEx). Windows keeps
//             each process's resident RAM at or under the value by paging the rest out.
//   cap     — job-object commit limit across the app (JOB_OBJECT_LIMIT_JOB_MEMORY). Windows
//             refuses allocations past it; apps may show errors or exit.
import { MB, formatBytes } from './format'
import { SHELL } from './windows-names'
import type { AppGroup, ProcInfo } from './types'

export type SealMode = 'watch' | 'ceiling' | 'cap'

export interface Seal {
  key: string
  name: string
  mode: SealMode
  bytes: number
  enabled: boolean
  createdAt: number
}

export interface SealOutcome {
  /** Running processes of the app. */
  matched: number
  /** Processes Windows accepted the limit for. */
  applied: number
  /** Processes Windows refused (access denied, protected, already in a non-nestable job). */
  denied: number
  /** Processes where the call failed for another reason. */
  failed: number
  lastError?: string
}

export type SealStateName = 'enforced' | 'partial' | 'watching' | 'unsupported' | 'paused' | 'waiting'

export interface SealState {
  state: SealStateName
  label: string
  detail: string
}

export const MIN_SEAL = 64 * MB

export function sealMetric(mode: SealMode): 'privateWs' | 'workingSet' | 'commit' {
  if (mode === 'cap') return 'commit'
  if (mode === 'ceiling') return 'workingSet'
  return 'privateWs'
}

export function sealState(seal: Seal, outcome: SealOutcome | null): SealState {
  if (!seal.enabled) {
    return { state: 'paused', label: 'Paused', detail: 'R.R. is not applying or watching this seal.' }
  }
  if (seal.mode === 'watch') {
    return {
      state: 'watching',
      label: 'Watching only',
      detail: 'R.R. flags the app when it goes over. Windows does not limit it.'
    }
  }
  const o = outcome ?? { matched: 0, applied: 0, denied: 0, failed: 0 }
  if (o.matched === 0) {
    return {
      state: 'waiting',
      label: 'Waiting for the app',
      detail: 'Not running. R.R. applies the seal when it starts, while R.R. is open.'
    }
  }
  if (o.applied === o.matched) {
    return {
      state: 'enforced',
      label: 'Enforced by Windows',
      detail:
        seal.mode === 'cap'
          ? `Windows refuses allocations past ${formatBytes(seal.bytes)} committed across ${plural(o.matched, 'process', 'processes')}.`
          : `Windows keeps each of ${plural(o.matched, 'process', 'processes')} at or under ${formatBytes(seal.bytes)} resident.`
    }
  }
  if (o.applied > 0) {
    return {
      state: 'partial',
      label: 'Partly enforced',
      detail: `Windows accepted ${o.applied} of ${o.matched} processes. The rest are only watched.${o.lastError ? ` ${o.lastError}` : ''}`
    }
  }
  return {
    state: 'unsupported',
    label: 'Not enforceable',
    detail: `Windows refused every process of this app.${o.lastError ? ` ${o.lastError}` : ''} R.R. is only watching it.`
  }
}

export function isOverSeal(seal: Seal, app: AppGroup, procs: ProcInfo[]): boolean {
  if (seal.mode === 'ceiling') return procs.some((p) => p.workingSet > seal.bytes)
  return app[sealMetric(seal.mode)] > seal.bytes
}

export interface Check {
  error?: string
  warnings: string[]
}

/** Validates a seal before it is saved. `largestWs` is the biggest single process working set. */
export function checkSeal(
  mode: SealMode,
  bytes: number,
  app: AppGroup,
  totalPhys: number,
  largestWs = app.workingSet
): Check {
  const warnings: string[] = []
  if (bytes < MIN_SEAL) return { error: 'Use at least 64 MB. Below that, most apps cannot run at all.', warnings }
  if (mode !== 'watch' && app.critical) {
    return { error: 'This is part of Windows. R.R. never limits Windows components; use Watch instead.', warnings }
  }
  if (mode !== 'watch' && SHELL.has(app.key)) {
    return { error: 'This is the Windows shell, which starts your other apps. R.R. never limits it; use Watch instead.', warnings }
  }
  if (mode !== 'watch' && app.access === 'none') {
    return {
      error: 'Windows denied R.R. access to this app (it runs as administrator or is protected). Use Watch instead.',
      warnings
    }
  }
  if (bytes >= totalPhys) warnings.push(`That is more than your usable RAM (${formatBytes(totalPhys)}), so it will never trigger.`)
  if (mode === 'cap' && bytes < app.commit) {
    warnings.push(
      `${app.name} has ${formatBytes(app.commit)} committed now. Windows will refuse its next allocations, which often shows as errors or the app closing. Unsaved work may be lost.`
    )
  }
  if (mode === 'ceiling' && bytes < largestWs) {
    warnings.push('Windows will page the excess out at once. Expect the app to slow down while it pages memory back in.')
  }
  if (mode === 'watch' && bytes < app.privateWs) warnings.push('The app is already over this, so it will be flagged right away.')
  if (mode !== 'watch' && app.access === 'partial') {
    warnings.push('Windows lets R.R. reach only some of its processes. The rest will be watched, not limited.')
  }
  return { warnings }
}

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`
}
