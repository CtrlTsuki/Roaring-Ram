// One interface over what each operating system really allows. Windows gets the full set of
// documented controls; other systems get monitoring only, and say so.
import os from 'node:os'
import { execFileSync } from 'node:child_process'
import type { Capabilities } from '../shared/ipc'
import type { SystemMemory } from '../shared/types'

export type ActionResult = { ok: true } | { ok: false; denied: boolean; code: number; message: string }

export interface RawProc {
  pid: number
  parentPid: number
  name: string
  privateWs: number
  workingSet: number
  commit: number
  /** Distinguishes a reused PID from the process that had it before. */
  createTime: string
}

export interface Platform {
  caps: Capabilities
  systemMemory(): SystemMemory
  processes(): RawProc[]
  canTrim(pid: number): boolean
  describe(pid: number): { path: string | null; description: string | null }
  windowOwners(): Map<number, unknown[]>
  /** `created` (when given) must match the process's creation time, or nothing is done. */
  trim(pid: number, created?: string): ActionResult
  setCeiling(pid: number, bytes: number | null, created?: string): ActionResult
  readCeiling(pid: number): number | null
  openJob(key: string): unknown
  closeJob(job: unknown): void
  /** PIDs inside a job, including ones the app placed there itself. */
  jobMembers(job: unknown): number[]
  setJobCap(job: unknown, bytes: number | null): ActionResult
  assignToJob(job: unknown, pid: number, created?: string): ActionResult
  requestClose(windows: unknown[]): number
}

const unsupported: ActionResult = { ok: false, denied: false, code: -1, message: 'Not supported on this system.' }

export async function loadPlatform(): Promise<Platform> {
  if (process.platform === 'win32') return windowsPlatform()
  return portablePlatform()
}

async function windowsPlatform(): Promise<Platform> {
  const w = await import('./win32')
  return {
    caps: {
      platform: 'win32',
      platformName: 'Windows',
      monitorProcesses: true,
      trim: true,
      ceiling: true,
      cap: true,
      askToClose: true,
      notes: []
    },
    systemMemory: w.systemMemory,
    processes: () => w.processes().map((p) => ({ ...p, createTime: p.createTime.toString() })),
    canTrim: w.canTrim,
    describe: (pid) => {
      const path = w.imagePath(pid)
      return { path, description: path ? w.fileDescription(path) : null }
    },
    windowOwners: w.windowOwners,
    trim: (pid, created) => w.trim(pid, toTime(created)),
    setCeiling: (pid, bytes, created) => w.setCeiling(pid, bytes, toTime(created)),
    readCeiling: w.readCeiling,
    openJob: w.openJob,
    closeJob: w.closeJob,
    jobMembers: w.jobProcessIds,
    setJobCap: w.setJobCap,
    assignToJob: (job, pid, created) => w.assignToJob(job, pid, toTime(created)),
    requestClose: w.requestClose
  }
}

function toTime(created?: string): bigint | undefined {
  return created ? BigInt(created) : undefined
}

/** macOS and Linux: monitoring through Node and `ps`. No supported per-app control is wired up. */
function portablePlatform(): Platform {
  const name = process.platform === 'darwin' ? 'macOS' : process.platform === 'linux' ? 'Linux' : process.platform
  return {
    caps: {
      platform: process.platform,
      platformName: name,
      monitorProcesses: true,
      trim: false,
      ceiling: false,
      cap: false,
      askToClose: false,
      notes: [
        `On ${name}, R.R. only monitors. ${
          process.platform === 'linux'
            ? 'Linux can limit apps with cgroup v2 (memory.max, memory.high), but only for apps launched inside a cgroup; R.R. does not manage cgroups yet.'
            : 'macOS offers no supported way for one app to limit or trim another.'
        }`,
        'Figures come from the resident set size, which counts shared memory in every process that maps it.'
      ]
    },
    systemMemory: () => {
      const total = os.totalmem()
      const free = os.freemem()
      return {
        totalPhys: total,
        installed: null,
        availPhys: free,
        used: total - free,
        commitTotal: 0,
        commitLimit: 0,
        cache: 0,
        kernelPaged: 0,
        kernelNonpaged: 0
      }
    },
    processes: () => {
      try {
        const out = execFileSync('ps', ['-axo', 'pid=,ppid=,rss=,lstart=,comm='], { encoding: 'utf8' })
        return out
          .split('\n')
          .filter(Boolean)
          .map((line) => {
            const m = line.trim().match(/^(\d+)\s+(\d+)\s+(\d+)\s+(\w{3} \w{3}\s+\d+ [\d:]+ \d{4})\s+(.*)$/)
            if (!m) return null
            const rss = Number(m[3]) * 1024
            return {
              pid: Number(m[1]),
              parentPid: Number(m[2]),
              name: m[5].split('/').pop() || m[5],
              privateWs: rss,
              workingSet: rss,
              commit: 0,
              createTime: m[4]
            }
          })
          .filter((p): p is RawProc => p !== null)
      } catch {
        return []
      }
    },
    canTrim: () => false,
    describe: () => ({ path: null, description: null }),
    windowOwners: () => new Map(),
    trim: () => unsupported,
    setCeiling: () => unsupported,
    readCeiling: () => null,
    openJob: () => null,
    closeJob: () => {},
    jobMembers: () => [],
    setJobCap: () => unsupported,
    assignToJob: () => unsupported,
    requestClose: () => 0
  }
}
