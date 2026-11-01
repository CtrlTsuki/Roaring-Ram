// The engine samples memory every few seconds, keeps seals applied, and runs the one-shot
// cleanups. Every action is measured before and after, and every result is written to the
// activity log (Echoes) with what Windows refused and what R.R. chose not to do.
import { randomUUID } from 'node:crypto'
import { appKey, groupProcesses, isTitan } from '../shared/apps'
import { planRoaring } from '../shared/cleanup'
import { formatBytes } from '../shared/format'
import { UsageHistory } from '../shared/history'
import type {
  ActionReply,
  AppDetail,
  AppRow,
  Echo,
  QuitPrompt,
  RoaringPreview,
  RoaringRequest,
  SealInput,
  Snapshot
} from '../shared/ipc'
import { checkSeal, isOverSeal, MIN_SEAL, sealState, type Seal, type SealOutcome } from '../shared/seals'
import type { AppGroup, ProcAccess, ProcInfo, SystemMemory } from '../shared/types'
import { assessWaterline, checkWaterline, untouchableFloor } from '../shared/waterline'
import { CRITICAL, SHELL } from '../shared/windows-names'
import type { Platform, RawProc } from './platform'
import type { Store } from './store'

const LIST_LIMIT = 60
const REBOUND_MS = 30_000
const SETTLE_MS = 1500

type Applied = Map<string, { ok: boolean; denied: boolean; message?: string }>

export class Engine {
  private history = new UsageHistory(5 * 60_000)
  private access = new Map<string, ProcAccess>()
  private described = new Map<string, string | null>()
  private paths = new Map<string, string>()
  private raw: RawProc[] = []
  private createTimes = new Map<number, string>()
  private procs: ProcInfo[] = []
  private sys: SystemMemory | null = null
  private owners = new Map<number, unknown[]>()
  private jobs = new Map<string, unknown>()
  private applied = new Map<string, Applied>()
  private over = new Map<string, boolean>()
  private capErrors = new Map<string, string>()
  private capContents = new Map<string, { commit: number; also: string[] }>()
  private busy: string | null = null
  private error: string | null = null
  private timer: NodeJS.Timeout | null = null
  private reboundTimers = new Set<NodeJS.Timeout>()
  private listener: ((s: Snapshot) => void) | null = null

  constructor(
    private readonly platform: Platform,
    private readonly store: Store,
    private readonly selfPids: () => Set<number>
  ) {}

  onSnapshot(fn: (s: Snapshot) => void): void {
    this.listener = fn
  }

  start(intervalMs: number): void {
    this.stop()
    this.tick()
    this.timer = setInterval(() => this.tick(), intervalMs)
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
  }

  dispose(): void {
    this.stop()
    for (const t of this.reboundTimers) clearTimeout(t)
    for (const job of this.jobs.values()) this.platform.closeJob(job)
    this.jobs.clear()
  }

  // ---------- sampling ----------

  tick(): void {
    try {
      this.sample()
      this.error = null
    } catch (e) {
      this.error = `Could not read memory: ${(e as Error).message}`
    }
    if (!this.error) {
      try {
        this.applySeals()
      } catch (e) {
        this.error = `Could not apply seals: ${(e as Error).message}`
      }
      this.watchSeals()
      this.describeTop()
    }
    this.listener?.(this.snapshot())
  }

  private sample(): void {
    const now = Date.now()
    this.sys = this.platform.systemMemory()
    this.raw = this.platform.processes()
    this.owners = this.platform.windowOwners()
    this.history.add({ t: now, used: this.sys.used, total: this.sys.totalPhys })

    const alive = new Set<string>()
    const procs: ProcInfo[] = []
    for (const r of this.raw) {
      const id = `${r.pid}:${r.createTime}`
      alive.add(id)
      const lower = r.name.toLowerCase()
      const critical = r.pid <= 4 || CRITICAL.has(lower)
      let access = this.access.get(id)
      if (!access) {
        access = r.pid > 4 && this.platform.canTrim(r.pid) ? 'trim' : 'denied'
        this.access.set(id, access)
      }
      procs.push({
        pid: r.pid,
        parentPid: r.parentPid,
        name: r.name,
        privateWs: r.privateWs,
        workingSet: r.workingSet,
        commit: r.commit,
        access,
        // Only windows R.R. can actually reach: Windows drops close requests to elevated apps.
        windows: this.owners.has(r.pid) && !critical && !SHELL.has(lower) && access === 'trim',
        critical,
        description: this.described.get(id) ?? undefined
      })
    }
    this.createTimes = new Map(this.raw.map((r) => [r.pid, r.createTime]))
    for (const id of this.access.keys()) if (!alive.has(id)) this.access.delete(id)
    for (const id of this.described.keys()) if (!alive.has(id)) this.described.delete(id)
    for (const applied of this.applied.values()) for (const id of applied.keys()) if (!alive.has(id)) applied.delete(id)
    this.procs = procs
  }

  /** Friendly names for the apps on screen; a few per tick so a fresh start never stalls. */
  private describeTop(): void {
    let budget = 25
    const top = new Set(groupProcesses(this.procs).slice(0, LIST_LIMIT).map((a) => a.key))
    for (const r of this.raw) {
      if (budget <= 0) break
      const id = `${r.pid}:${r.createTime}`
      if (this.described.has(id) || !top.has(appKey(r.name)) || r.pid <= 4) continue
      const d = this.platform.describe(r.pid)
      this.described.set(id, d.description)
      if (d.path && !this.paths.has(appKey(r.name))) this.paths.set(appKey(r.name), d.path)
      budget--
    }
  }

  private procId(p: ProcInfo): string {
    return `${p.pid}:${this.createTimes.get(p.pid) ?? ''}`
  }

  private procsOf(key: string): ProcInfo[] {
    return this.procs.filter((p) => appKey(p.name) === key)
  }

  // ---------- seals ----------

  private job(key: string): unknown {
    let job = this.jobs.get(key)
    if (!job) {
      job = this.platform.openJob(key)
      this.jobs.set(key, job)
    }
    return job
  }

  private applySeals(): void {
    for (const seal of this.store.state.seals) {
      if (!seal.enabled || seal.mode === 'watch') continue
      const applied = this.applied.get(seal.key) ?? new Map()
      this.applied.set(seal.key, applied)
      let job: unknown = null
      if (seal.mode === 'cap') {
        job = this.job(seal.key)
        // Idempotent: re-states the current value on the job each pass.
        const r = this.platform.setJobCap(job, seal.bytes)
        if (r.ok) this.capErrors.delete(seal.key)
        else this.capErrors.set(seal.key, `Windows refused the limit: ${r.message}`)
      }
      for (const p of this.procsOf(seal.key)) {
        if (p.critical) continue
        const id = this.procId(p)
        if (applied.has(id)) continue
        const created = this.createTimes.get(p.pid)
        const r = seal.mode === 'cap' ? this.platform.assignToJob(job, p.pid, created) : this.platform.setCeiling(p.pid, seal.bytes, created)
        applied.set(id, r.ok ? { ok: true, denied: false } : { ok: false, denied: r.denied, message: r.message })
      }
      if (seal.mode === 'cap') this.measureCap(seal.key, job)
    }
  }

  /** What a cap really holds: every process in its job, including any the app put there itself. */
  private measureCap(key: string, job: unknown): void {
    const members = new Set(this.platform.jobMembers(job))
    let commit = 0
    const also = new Set<string>()
    for (const p of this.procs) {
      if (!members.has(p.pid)) continue
      commit += p.commit
      if (appKey(p.name) !== key) also.add(p.name)
    }
    this.capContents.set(key, { commit, also: [...also].sort() })
  }

  /** Seal state, with the honest addendum when a cap also holds programs the app launched. */
  private stateOf(seal: Seal) {
    const state = sealState(seal, this.outcome(seal))
    const contents = seal.mode === 'cap' && seal.enabled ? this.capContents.get(seal.key) : undefined
    if (!contents?.also.length) return state
    return {
      ...state,
      detail: `${state.detail} The app also placed ${contents.also.join(', ')} in this cap, so their memory counts toward it.`
    }
  }

  private outcome(seal: Seal): SealOutcome {
    const procs = this.procsOf(seal.key).filter((p) => !p.critical)
    const capError = seal.mode === 'cap' ? this.capErrors.get(seal.key) : undefined
    if (capError) return { matched: procs.length, applied: 0, denied: 0, failed: procs.length, lastError: capError }
    const applied = this.applied.get(seal.key)
    const o: SealOutcome = { matched: procs.length, applied: 0, denied: 0, failed: 0 }
    for (const p of procs) {
      const r = applied?.get(this.procId(p))
      if (!r) continue
      if (r.ok) o.applied++
      else if (r.denied) o.denied++
      else o.failed++
      if (!r.ok && r.message) o.lastError = r.message
    }
    if (o.denied && !o.lastError?.includes('denied')) o.lastError = 'Windows denied access to some processes.'
    return o
  }

  private lockedCount(seal: Seal): number {
    const ids = new Set(this.raw.map((r) => `${r.pid}:${r.createTime}`))
    return this.store.state.lockedCaps.filter((l) => l.key === seal.key && ids.has(`${l.pid}:${l.createTime}`)).length
  }

  private watchSeals(): void {
    const apps = new Map(groupProcesses(this.procs).map((a) => [a.key, a]))
    for (const seal of this.store.state.seals) {
      if (!seal.enabled) continue
      const app = apps.get(seal.key)
      const wasOver = this.over.get(seal.key) ?? false
      let isOver = false
      const capCommit = seal.mode === 'cap' ? this.capContents.get(seal.key)?.commit : undefined
      if (app && capCommit) {
        isOver = capCommit > seal.bytes || (wasOver && capCommit > seal.bytes * 0.95)
      } else if (app) {
        isOver = isOverSeal(seal, app, this.procsOf(seal.key))
        // Hysteresis: once flagged, stay flagged until 5% under, so the log doesn't flicker.
        if (wasOver && !isOver) isOver = isOverSeal({ ...seal, bytes: seal.bytes * 0.95 }, app, this.procsOf(seal.key))
      }
      const state = this.stateOf(seal).state
      const watched = seal.mode === 'watch' || state === 'partial' || state === 'unsupported'
      if (isOver && !wasOver && watched) {
        const metric = seal.mode === 'cap' ? 'committed' : seal.mode === 'ceiling' ? 'resident in its largest process' : 'private memory'
        const used =
          seal.mode === 'cap'
            ? capCommit ?? app!.commit
            : seal.mode === 'ceiling'
              ? Math.max(...this.procsOf(seal.key).map((p) => p.workingSet))
              : app!.privateWs
        this.store.addEcho({
          id: randomUUID(),
          t: Date.now(),
          kind: 'watch',
          title: `${app!.description ?? app!.name} passed its seal`,
          lines: [`${formatBytes(used)} ${metric}, against a seal of ${formatBytes(seal.bytes)}.`],
          limits: [
            seal.mode === 'watch'
              ? 'Watch seals are not enforced. Run Titan on it or close it if you need the memory back.'
              : 'Windows enforces this seal on only some of its processes, or none. The rest are only watched.'
          ],
          ok: true
        })
      }
      this.over.set(seal.key, isOver)
    }
  }

  private clearEnforcement(seal: Seal): void {
    if (seal.mode === 'cap') {
      const job = this.jobs.get(seal.key)
      if (job) this.platform.setJobCap(job, null)
    } else if (seal.mode === 'ceiling') {
      for (const p of this.procsOf(seal.key)) {
        if (this.applied.get(seal.key)?.get(this.procId(p))?.ok) this.platform.setCeiling(p.pid, null, this.createTimes.get(p.pid))
      }
    }
    this.applied.delete(seal.key)
  }

  saveSeal(input: SealInput): ActionReply {
    if (!this.sys) return { ok: false, error: 'Memory has not been read yet.' }
    const key = appKey(String(input.key))
    if (!['watch', 'ceiling', 'cap'].includes(input.mode)) return { ok: false, error: 'Unknown seal type.' }
    if (!(typeof input.bytes === 'number' && Number.isFinite(input.bytes))) return { ok: false, error: 'Enter a size.' }
    if (input.mode !== 'watch' && !this.platform.caps[input.mode]) {
      return { ok: false, error: `${this.platform.caps.platformName} doesn't offer this kind of limit to R.R.` }
    }
    const app = groupProcesses(this.procs).find((a) => a.key === key)
    const existing = this.store.state.seals.find((s) => s.key === key)
    if (!app && !existing) return { ok: false, error: 'That app is no longer running.' }
    const name = app?.name ?? existing!.name

    if (input.bytes < MIN_SEAL) return { ok: false, error: 'Use at least 64 MB. Below that, most apps cannot run at all.' }
    if (input.mode !== 'watch' && CRITICAL.has(key)) {
      return { ok: false, error: 'This is part of Windows. R.R. never limits Windows components; use Watch instead.' }
    }
    if (app) {
      const largest = Math.max(0, ...this.procsOf(key).map((p) => p.workingSet))
      const check = checkSeal(input.mode, input.bytes, app, this.sys.totalPhys, largest)
      if (check.error) return { ok: false, error: check.error }
      if (input.mode === 'cap' && input.bytes < app.commit && !input.acceptRisk) {
        return { ok: false, error: 'risk' }
      }
    }

    if (existing && (existing.mode !== input.mode || !existing.enabled)) this.clearEnforcement(existing)
    // A new ceiling size must reach processes already sealed at the old one.
    else if (existing && existing.mode === 'ceiling' && existing.bytes !== Math.round(input.bytes)) this.applied.delete(key)
    const seal: Seal = { key, name, mode: input.mode, bytes: Math.round(input.bytes), enabled: true, createdAt: existing?.createdAt ?? Date.now() }
    this.store.state.seals = [...this.store.state.seals.filter((s) => s.key !== key), seal]
    this.store.save()
    this.applySeals()
    const state = sealState(seal, this.outcome(seal))
    const label = app?.description ?? name
    const echo: Echo = {
      id: randomUUID(),
      t: Date.now(),
      kind: 'seal',
      title: `${existing ? 'Seal changed' : 'Seal set'} on ${label}`,
      lines: [`${modeName(seal.mode)} at ${formatBytes(seal.bytes)}. ${state.label}.`, state.detail],
      limits: sealLimits(seal.mode, this.lockedCount(seal)),
      ok: state.state !== 'unsupported'
    }
    this.store.addEcho(echo)
    this.tick()
    return { ok: true, echo }
  }

  removeSeal(rawKey: string): ActionReply {
    const key = appKey(String(rawKey))
    const seal = this.store.state.seals.find((s) => s.key === key)
    if (!seal) return { ok: false, error: 'No seal on that app.' }
    this.clearEnforcement(seal)
    this.over.delete(key)
    this.capErrors.delete(key)
    this.capContents.delete(key)
    this.store.state.seals = this.store.state.seals.filter((s) => s.key !== key)
    this.store.save()
    const limits: string[] = []
    if (seal.mode === 'cap') limits.push('Its processes stay in R.R.’s job until they exit, now with no limit. Windows has no way to take a process out of a job.')
    const locked = this.lockedCount(seal)
    if (locked) limits.push(`${locked} process${locked === 1 ? '' : 'es'} keep a cap from an earlier R.R. session until they exit.`)
    const echo: Echo = { id: randomUUID(), t: Date.now(), kind: 'seal', title: `Seal removed from ${seal.name}`, lines: ['R.R. no longer limits or watches this app.'], limits, ok: true }
    this.store.addEcho(echo)
    this.tick()
    return { ok: true, echo }
  }

  setSealEnabled(rawKey: string, enabled: boolean): ActionReply {
    const key = appKey(String(rawKey))
    const seal = this.store.state.seals.find((s) => s.key === key)
    if (!seal) return { ok: false, error: 'No seal on that app.' }
    if (!enabled) this.clearEnforcement(seal)
    seal.enabled = Boolean(enabled)
    this.over.delete(key)
    this.store.save()
    this.applySeals()
    const state = sealState(seal, this.outcome(seal))
    const echo: Echo = {
      id: randomUUID(),
      t: Date.now(),
      kind: 'seal',
      title: `Seal ${seal.enabled ? 'resumed' : 'paused'} on ${seal.name}`,
      lines: [
        seal.enabled
          ? `${modeName(seal.mode)} at ${formatBytes(seal.bytes)}. ${state.label}.`
          : 'R.R. has lifted the limit and stopped watching this app.'
      ],
      limits: [],
      ok: true
    }
    this.store.addEcho(echo)
    this.tick()
    return { ok: true, echo }
  }

  // ---------- waterline ----------

  setWaterline(bytes: number | null): ActionReply {
    if (!this.sys) return { ok: false, error: 'Memory has not been read yet.' }
    if (bytes != null) {
      const check = checkWaterline(Number(bytes), this.sys.totalPhys)
      if (check.error) return { ok: false, error: check.error }
    }
    const before = this.store.state.waterline
    this.store.state.waterline = bytes == null ? null : Math.round(Number(bytes))
    this.store.save()
    const echo: Echo = {
      id: randomUUID(),
      t: Date.now(),
      kind: 'waterline',
      title: bytes == null ? 'Waterline cleared' : `Waterline ${before == null ? 'set' : 'moved'} to ${formatBytes(bytes)}`,
      lines: bytes == null ? [] : [`In use now: ${formatBytes(this.sys.used)} of ${formatBytes(this.sys.totalPhys)}.`],
      limits: bytes == null ? [] : ['A target, not a limit. Windows has no setting that caps total memory use.'],
      ok: true
    }
    this.store.addEcho(echo)
    this.tick()
    return { ok: true, echo }
  }

  // ---------- cleanups ----------

  previewRoaring(): RoaringPreview {
    const plan = planRoaring(this.procs, this.selfPids())
    return {
      trimCount: plan.trim.length,
      trimApps: new Set(plan.trim.map((p) => appKey(p.name))).size,
      skipped: plan.skipped,
      closeCandidates: plan.closeCandidates.slice(0, 12).map((a) => ({
        key: a.key,
        name: a.name,
        description: a.description,
        privateWs: a.privateWs,
        windows: a.pids.reduce((n, pid) => n + (this.owners.get(pid)?.length ?? 0), 0)
      })),
      used: this.sys?.used ?? 0,
      target: this.store.state.waterline
    }
  }

  async runRoaring(req: RoaringRequest): Promise<ActionReply> {
    if (this.busy) return { ok: false, error: 'Another action is still running.' }
    if (!this.platform.caps.trim) return { ok: false, error: `${this.platform.caps.platformName} gives R.R. no supported way to do this.` }
    this.busy = 'The Roaring'
    this.listener?.(this.snapshot())
    try {
      const plan = planRoaring(this.procs, this.selfPids())
      const chosen = new Set((Array.isArray(req?.close) ? req.close : []).map((k) => appKey(String(k))))
      const before = this.platform.systemMemory().used

      let trimmed = 0
      let exited = 0
      let denied = 0
      for (const p of plan.trim) {
        const r = this.platform.trim(p.pid, this.createTimes.get(p.pid))
        if (r.ok) trimmed++
        else if (r.denied) denied++
        else exited++
      }

      const asked: string[] = []
      for (const app of plan.closeCandidates) {
        if (!chosen.has(app.key)) continue
        const windows = app.pids.flatMap((pid) => this.owners.get(pid) ?? [])
        if (this.platform.requestClose(windows) > 0) asked.push(app.description ?? app.name)
      }

      await sleep(SETTLE_MS)
      const after = this.platform.systemMemory().used
      const target = this.store.state.waterline
      this.sample()

      const lines = [`Trimmed the working sets of ${trimmed} processes in ${new Set(plan.trim.map((p) => appKey(p.name))).size} apps.`]
      if (asked.length) lines.push(`Asked ${asked.join(', ')} to close. They may wait for you to save.`)
      const limits: string[] = []
      for (const s of plan.skipped) {
        if (s.reason === 'windows') limits.push(`Left ${s.count} Windows components alone.`)
        if (s.reason === 'denied') limits.push(`Windows denied access to ${s.count} processes (administrator, other users or protected).`)
      }
      if (denied) limits.push(`${denied} more refused access during the run.`)
      if (exited) limits.push(`${exited} exited before they could be trimmed.`)
      if (target != null) {
        const floor = untouchableFloor(this.sys!, this.procs)
        const w = assessWaterline(target, after, floor)
        lines.push(w.state === 'met' ? `Under your waterline of ${formatBytes(target)}.` : `Still ${formatBytes(w.gap)} over your waterline of ${formatBytes(target)}.`)
        if (w.state === 'unreachable') limits.push(w.message)
        else if (w.state === 'above') limits.push('Trimming cannot make apps give up memory they are actively using. Closing apps is the reliable way down.')
      }
      limits.push('Trimmed pages stay cached and return as apps touch them, so some of this comes back.')

      const echo: Echo = {
        id: randomUUID(),
        t: Date.now(),
        kind: 'roaring',
        title: 'The Roaring',
        change: { before, after, label: 'In use' },
        lines,
        limits,
        ok: true
      }
      this.store.addEcho(echo)
      this.scheduleRebound(echo.id)
      return { ok: true, echo }
    } finally {
      this.busy = null
      this.tick()
    }
  }

  async runTitan(rawKey: string): Promise<ActionReply> {
    if (this.busy) return { ok: false, error: 'Another action is still running.' }
    const key = appKey(String(rawKey))
    const procs = this.procsOf(key)
    if (!procs.length) return { ok: false, error: 'That app is no longer running.' }
    const app = groupProcesses(procs)[0]
    const label = app.description ?? app.name
    const reachable = procs.filter((p) => !p.critical && p.access === 'trim')

    if (!this.platform.caps.trim || app.critical || !reachable.length) {
      const reason = !this.platform.caps.trim
        ? `${this.platform.caps.platformName} gives R.R. no supported way to trim another app.`
        : app.critical
          ? 'It is part of Windows, and R.R. leaves Windows components alone.'
          : 'Windows denied R.R. access to it (it runs as administrator, as another user, or is protected).'
      const echo: Echo = { id: randomUUID(), t: Date.now(), kind: 'titan', title: `Titan: ${label}`, lines: ['No supported action was available.'], limits: [reason], ok: false }
      this.store.addEcho(echo)
      this.tick()
      return { ok: true, echo }
    }

    this.busy = 'Titan'
    this.listener?.(this.snapshot())
    try {
      const before = sum(this.platform.processes().filter((p) => appKey(p.name) === key), 'privateWs')
      const commitBefore = app.commit
      let trimmed = 0
      for (const p of reachable) if (this.platform.trim(p.pid, this.createTimes.get(p.pid)).ok) trimmed++
      await sleep(800)
      const fresh = this.platform.processes().filter((p) => appKey(p.name) === key)
      const after = sum(fresh, 'privateWs')
      const commitAfter = sum(fresh, 'commit')
      const limits: string[] = []
      if (trimmed < procs.length) limits.push(`${procs.length - trimmed} of its ${procs.length} processes could not be trimmed.`)
      limits.push(
        `Committed memory is ${formatBytes(commitAfter)} (was ${formatBytes(commitBefore)}). Trimming can't make an app free what it has allocated; only the app can.`
      )
      limits.push('It will pull pages back as it needs them.')
      const echo: Echo = {
        id: randomUUID(),
        t: Date.now(),
        kind: 'titan',
        title: `Titan: ${label}`,
        change: { before, after, label: 'Private memory' },
        lines: [`Trimmed ${trimmed} of ${procs.length} processes.`],
        limits,
        ok: true
      }
      this.store.addEcho(echo)
      this.scheduleRebound(echo.id, key)
      return { ok: true, echo }
    } finally {
      this.busy = null
      this.tick()
    }
  }

  askToClose(rawKey: string): ActionReply {
    const key = appKey(String(rawKey))
    const procs = this.procsOf(key).filter((p) => p.windows)
    if (!this.platform.caps.askToClose || !procs.length) return { ok: false, error: 'This app has no window R.R. can ask to close.' }
    const windows = procs.flatMap((p) => this.owners.get(p.pid) ?? [])
    const posted = this.platform.requestClose(windows)
    const label = groupProcesses(this.procsOf(key))[0]?.description ?? key
    const echo: Echo = {
      id: randomUUID(),
      t: Date.now(),
      kind: 'close',
      title: `Asked ${label} to close`,
      lines: [`Sent a close request to ${posted} window${posted === 1 ? '' : 's'}, the same as clicking its close button.`],
      limits: ['The app decides: it may ask you to save, keep running in the tray, or ignore the request.'],
      ok: posted > 0
    }
    this.store.addEcho(echo)
    this.tick()
    return { ok: true, echo }
  }

  private scheduleRebound(id: string, key?: string): void {
    const t = setTimeout(() => {
      this.reboundTimers.delete(t)
      const echo = this.store.state.echoes.find((e) => e.id === id)
      if (!echo) return
      const fresh = key ? this.platform.processes().filter((p) => appKey(p.name) === key) : []
      const after = key ? sum(fresh, 'privateWs') : this.platform.systemMemory().used
      echo.rebound = { after, t: Date.now(), exited: !!key && fresh.length === 0 }
      this.store.save()
      this.listener?.(this.snapshot())
    }, REBOUND_MS)
    this.reboundTimers.add(t)
  }

  clearEchoes(): void {
    this.store.state.echoes = []
    this.store.save()
    this.listener?.(this.snapshot())
  }

  // ---------- detail and quitting ----------

  /** Executable path of an app, once R.R. has looked it up. Used for its icon. */
  appPath(rawKey: string): string | null {
    return this.paths.get(appKey(String(rawKey))) ?? null
  }

  appDetail(rawKey: string): AppDetail {
    const key = appKey(String(rawKey))
    const processes = this.procsOf(key).sort((a, b) => b.privateWs - a.privateWs)
    const path = processes[0] ? this.platform.describe(processes[0].pid).path : null
    const closableWindows = processes.reduce((n, p) => n + (p.windows ? this.owners.get(p.pid)?.length ?? 0 : 0), 0)
    const group = processes.length ? groupProcesses(processes)[0] : null
    const row = group && this.sys ? this.toRow(group, this.sys.totalPhys) : null
    return { key, processes, path, closableWindows, row }
  }

  /** Caps currently enforced, which Windows keeps in force after R.R. quits (see quit flow). */
  quitPrompt(): QuitPrompt {
    return {
      caps: this.store.state.seals
        .filter((s) => s.enabled && s.mode === 'cap' && this.outcome(s).applied > 0)
        .map((s) => ({ name: s.name, bytes: s.bytes }))
    }
  }

  /** Before quitting: either lift caps, or remember which processes keep one so the UI can say so. */
  prepareQuit(liftCaps: boolean): void {
    const ids = new Map(this.raw.map((r) => [r.pid, r.createTime]))
    for (const seal of this.store.state.seals) {
      if (seal.mode === 'ceiling' && seal.enabled) this.clearEnforcement(seal)
    }
    for (const seal of this.store.state.seals) {
      if (seal.mode !== 'cap' || !seal.enabled) continue
      if (liftCaps) {
        const job = this.jobs.get(seal.key)
        if (job) this.platform.setJobCap(job, null)
        continue
      }
      for (const [id, r] of this.applied.get(seal.key) ?? []) {
        if (!r.ok) continue
        const [pid, createTime] = id.split(':')
        if (ids.get(Number(pid)) === createTime) {
          this.store.state.lockedCaps.push({ key: seal.key, pid: Number(pid), createTime, bytes: seal.bytes })
        }
      }
    }
    // Forget locks whose processes are gone.
    const alive = new Set(this.raw.map((r) => `${r.pid}:${r.createTime}`))
    this.store.state.lockedCaps = this.store.state.lockedCaps.filter((l) => alive.has(`${l.pid}:${l.createTime}`))
    this.store.flush()
  }

  // ---------- snapshot ----------

  private toRow(a: AppGroup, totalPhys: number): AppRow {
    const seal = this.store.state.seals.find((s) => s.key === a.key)
    return {
      key: a.key,
      name: a.name,
      description: a.description,
      processCount: a.processCount,
      privateWs: a.privateWs,
      workingSet: a.workingSet,
      commit: a.commit,
      access: a.access,
      hasWindows: a.hasWindows,
      critical: a.critical,
      titan: isTitan(a.privateWs, totalPhys),
      seal: seal && {
        mode: seal.mode,
        bytes: seal.bytes,
        enabled: seal.enabled,
        state: this.stateOf(seal),
        over: this.over.get(seal.key) ?? false,
        capCommit: seal.mode === 'cap' ? this.capContents.get(seal.key)?.commit : undefined,
        also: seal.mode === 'cap' ? this.capContents.get(seal.key)?.also : undefined
      }
    }
  }

  snapshot(): Snapshot {
    const sys = this.sys ?? { totalPhys: 0, installed: null, availPhys: 0, used: 0, commitTotal: 0, commitLimit: 0, cache: 0, kernelPaged: 0, kernelNonpaged: 0 }
    const now = Date.now()
    const groups = groupProcesses(this.procs)
    const sealsByKey = new Map(this.store.state.seals.map((s) => [s.key, s]))
    const toRow = (a: AppGroup) => this.toRow(a, sys.totalPhys)
    const shown = groups.slice(0, LIST_LIMIT)
    // Sealed apps always stay visible, even when small.
    for (const g of groups.slice(LIST_LIMIT)) if (sealsByKey.has(g.key)) shown.push(g)
    const restGroups = groups.filter((g) => !shown.includes(g))
    const floor = !this.sys ? 0 : this.platform.caps.trim ? untouchableFloor(sys, this.procs) : sys.kernelPaged + sys.kernelNonpaged
    const target = this.store.state.waterline
    return {
      t: now,
      sys,
      average: this.history.average(now),
      history: this.history.samples(now),
      apps: shown.map(toRow),
      rest: { count: restGroups.length, privateWs: restGroups.reduce((n, g) => n + g.privateWs, 0) },
      processCount: this.procs.length,
      floor,
      waterline: target == null || !this.sys ? null : { target, assessment: assessWaterline(target, sys.used, floor) },
      seals: this.store.state.seals.map((s) => ({ ...s, state: this.stateOf(s), over: this.over.get(s.key) ?? false, locked: this.lockedCount(s) })),
      echoes: this.store.state.echoes.slice(0, 80),
      busy: this.busy,
      error: this.error
    }
  }
}

function modeName(mode: Seal['mode']): string {
  return mode === 'cap' ? 'Hard cap' : mode === 'ceiling' ? 'Ceiling' : 'Watch'
}

function sealLimits(mode: Seal['mode'], locked: number): string[] {
  const out: string[] = []
  if (mode === 'cap') out.push('At the cap, Windows refuses new allocations. The app may show errors or close, and unsaved work may be lost.')
  if (mode === 'ceiling') {
    out.push('Applies to each process on its own. Past it, Windows pages memory out, so the app slows down instead of failing.')
    out.push('Ceilings are lifted when R.R. quits and applied again when it starts.')
  }
  if (mode === 'cap') {
    out.push('Programs the app launches stay outside the cap, unless the app places them in a job of its own; R.R. lists any it finds.')
  }
  if (mode === 'watch') out.push('Watch seals are not enforced.')
  if (mode !== 'watch') out.push('New processes of this app are sealed only while R.R. is running.')
  if (locked) out.push(`${locked} process${locked === 1 ? '' : 'es'} keep a cap from an earlier R.R. session until they exit.`)
  return out
}

function sum<T extends Record<K, number>, K extends string>(items: T[], k: K): number {
  return items.reduce((n, x) => n + x[k], 0)
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}
