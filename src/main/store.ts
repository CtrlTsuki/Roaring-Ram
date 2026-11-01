// R.R.'s saved state: the waterline, seals, the activity log, and caps left on running apps by an
// earlier session. A small JSON file in the app's user-data folder, written atomically.
import fs from 'node:fs'
import path from 'node:path'
import type { Echo } from '../shared/ipc'
import type { Seal } from '../shared/seals'

export interface LockedCap {
  key: string
  pid: number
  createTime: string
  bytes: number
}

export interface State {
  version: 1
  waterline: number | null
  seals: Seal[]
  echoes: Echo[]
  lockedCaps: LockedCap[]
}

const MAX_ECHOES = 150

export class Store {
  state: State
  private timer: NodeJS.Timeout | null = null

  constructor(private readonly file: string) {
    this.state = this.read()
  }

  private read(): State {
    const empty: State = { version: 1, waterline: null, seals: [], echoes: [], lockedCaps: [] }
    try {
      const data = JSON.parse(fs.readFileSync(this.file, 'utf8'))
      if (data?.version !== 1) return empty
      return {
        version: 1,
        waterline: typeof data.waterline === 'number' && data.waterline > 0 ? data.waterline : null,
        seals: Array.isArray(data.seals) ? data.seals.filter(isSeal) : [],
        echoes: Array.isArray(data.echoes) ? data.echoes.filter(isEcho).slice(0, MAX_ECHOES) : [],
        lockedCaps: Array.isArray(data.lockedCaps) ? data.lockedCaps.filter(isLockedCap) : []
      }
    } catch {
      return empty
    }
  }

  addEcho(echo: Echo): void {
    this.state.echoes.unshift(echo)
    this.state.echoes.length = Math.min(this.state.echoes.length, MAX_ECHOES)
    this.save()
  }

  save(): void {
    if (this.timer) return
    this.timer = setTimeout(() => this.flush(), 250)
  }

  flush(): void {
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true })
      const tmp = this.file + '.tmp'
      fs.writeFileSync(tmp, JSON.stringify(this.state, null, 1))
      fs.renameSync(tmp, this.file)
    } catch (e) {
      // Losing one save is better than crashing the app that holds the seals.
      console.error('R.R. could not save its state:', (e as Error).message)
    }
  }
}

function isEcho(e: unknown): e is Echo {
  const x = e as Echo
  return (
    !!x &&
    typeof x.id === 'string' &&
    typeof x.t === 'number' &&
    typeof x.title === 'string' &&
    Array.isArray(x.lines) &&
    x.lines.every((l) => typeof l === 'string') &&
    Array.isArray(x.limits) &&
    x.limits.every((l) => typeof l === 'string')
  )
}

function isLockedCap(l: unknown): l is LockedCap {
  const x = l as LockedCap
  return !!x && typeof x.key === 'string' && typeof x.pid === 'number' && typeof x.createTime === 'string' && typeof x.bytes === 'number'
}

function isSeal(s: unknown): s is Seal {
  const x = s as Seal
  return (
    !!x &&
    typeof x.key === 'string' &&
    typeof x.name === 'string' &&
    (x.mode === 'watch' || x.mode === 'ceiling' || x.mode === 'cap') &&
    typeof x.bytes === 'number' &&
    typeof x.enabled === 'boolean'
  )
}
