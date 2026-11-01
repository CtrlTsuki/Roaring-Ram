// Shared shapes passed between the main process (which talks to the OS) and the renderer.
// Every byte figure is a plain number of bytes; formatting happens at the edge.

/** What R.R. may do to a process, decided by what Windows grants a standard user. */
export type ProcAccess =
  /** R.R. can trim its working set and apply limits (PROCESS_SET_QUOTA granted). */
  | 'trim'
  /** Windows refused: elevated, another user's, protected, or a system process. */
  | 'denied'
  /** Not probed yet (process appeared since the last probe). */
  | 'unknown'

export interface ProcInfo {
  pid: number
  parentPid: number
  /** Executable name as Windows reports it, e.g. "chrome.exe". */
  name: string
  /** Private working set: RAM only this process uses. Task Manager's default "Memory" column. */
  privateWs: number
  /** Full working set, including pages shared with other processes. */
  workingSet: number
  /** Committed private memory (private bytes). What a job-object cap counts. */
  commit: number
  access: ProcAccess
  /** Has a visible top-level window, so it can be asked to close. */
  windows: boolean
  /** Part of Windows itself; never acted on, even if access were granted. */
  critical: boolean
  /** Friendly name from the executable's version info, when readable. */
  description?: string
}

export type AppAccess = 'full' | 'partial' | 'none'

export interface AppGroup {
  /** Lower-cased executable name; the identity used for limits. */
  key: string
  name: string
  description?: string
  pids: number[]
  processCount: number
  privateWs: number
  workingSet: number
  commit: number
  access: AppAccess
  hasWindows: boolean
  critical: boolean
}

export interface SystemMemory {
  /** RAM Windows can use (installed minus hardware-reserved). */
  totalPhys: number
  /** RAM sticks reported by firmware, when available. */
  installed: number | null
  /** Free + zeroed + standby (cache that is handed back on demand). */
  availPhys: number
  /** totalPhys − availPhys: what Task Manager calls "In use" (plus modified pages). */
  used: number
  commitTotal: number
  commitLimit: number
  /** System file cache resident in RAM. Part of "available" when on the standby list. */
  cache: number
  kernelPaged: number
  kernelNonpaged: number
}

export interface UsageSample {
  t: number
  used: number
  total: number
}

export interface UsageAverage {
  usedBytes: number
  fraction: number
  peakBytes: number
  coveredMs: number
  complete: boolean
}
