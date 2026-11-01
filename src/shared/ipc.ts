// Payloads exchanged between the main process and the renderer.
import type { Seal, SealMode, SealState } from './seals'
import type { AppAccess, ProcInfo, SystemMemory, UsageAverage, UsageSample } from './types'
import type { WaterlineState } from './waterline'

export interface Capabilities {
  platform: NodeJS.Platform
  /** Human name of the platform for copy, e.g. "Windows". */
  platformName: string
  monitorProcesses: boolean
  trim: boolean
  ceiling: boolean
  cap: boolean
  askToClose: boolean
  /** Shown when the platform cannot do something, in plain words. */
  notes: string[]
}

export interface AppRow {
  key: string
  name: string
  description?: string
  processCount: number
  privateWs: number
  workingSet: number
  commit: number
  access: AppAccess
  hasWindows: boolean
  critical: boolean
  titan: boolean
  seal?: {
    mode: SealMode
    bytes: number
    enabled: boolean
    state: SealState
    over: boolean
    /** Hard caps only: committed memory of everything inside the cap's job. */
    capCommit?: number
    /** Hard caps only: other programs the app placed in the cap's job itself. */
    also?: string[]
  }
}

export interface Snapshot {
  t: number
  sys: SystemMemory
  average: UsageAverage | null
  history: UsageSample[]
  apps: AppRow[]
  /** Apps beyond the visible list, folded into one row. */
  rest: { count: number; privateWs: number }
  processCount: number
  floor: number
  waterline: { target: number; assessment: WaterlineState } | null
  seals: (Seal & { state: SealState; over: boolean; locked: number })[]
  echoes: Echo[]
  busy: string | null
  error: string | null
}

export type EchoKind = 'roaring' | 'titan' | 'seal' | 'close' | 'watch' | 'waterline' | 'error'

export interface Echo {
  id: string
  t: number
  kind: EchoKind
  title: string
  /** Measured change in bytes (after − before), when the action was measured. */
  change?: { before: number; after: number; label: string }
  /** What happened, one short line each. */
  lines: string[]
  /** Why it fell short, what Windows refused, or what R.R. does not do. */
  limits: string[]
  ok: boolean
  /** Filled in ~30 s later: how much came back as apps touched their memory again. */
  rebound?: { after: number; t: number; exited?: boolean }
}

export interface RoaringPreview {
  trimCount: number
  trimApps: number
  skipped: { reason: 'windows' | 'denied' | 'self'; count: number; names: string[] }[]
  closeCandidates: { key: string; name: string; description?: string; privateWs: number; windows: number }[]
  used: number
  target: number | null
}

export interface RoaringRequest {
  /** App keys the person explicitly chose to ask to close. */
  close: string[]
}

export interface ActionReply {
  ok: boolean
  echo?: Echo
  error?: string
}

export interface SealInput {
  key: string
  mode: SealMode
  bytes: number
  /** The person ticked "I understand this may close the app" for a cap below current use. */
  acceptRisk: boolean
}

export interface AppDetail {
  key: string
  processes: ProcInfo[]
  path: string | null
  closableWindows: number
  /** The app's row even when it is too small to be in the main list; null once it has exited. */
  row: AppRow | null
}

export interface QuitPrompt {
  caps: { name: string; bytes: number }[]
}
