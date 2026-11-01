import { useEffect, useRef, useState, type CSSProperties } from 'react'
import { formatBytes } from '../../shared/format'
import type { AppRow, Snapshot } from '../../shared/ipc'

const RESORT_MS = 10_000
const iconCache = new Map<string, string | null>()

export function AppIcon({ appKey, name }: { appKey: string; name: string }) {
  const [src, setSrc] = useState(() => iconCache.get(appKey) ?? null)
  useEffect(() => {
    if (iconCache.has(appKey)) {
      setSrc(iconCache.get(appKey) ?? null)
      return
    }
    let live = true
    const tryLoad = (attempt: number) => {
      void window.rr.appIcon(appKey).then((url) => {
        if (!live) return
        // The path is looked up a few apps per tick; ask again shortly if it isn't known yet.
        if (!url && attempt < 4) window.setTimeout(() => tryLoad(attempt + 1), 2500)
        else {
          iconCache.set(appKey, url)
          setSrc(url)
        }
      })
    }
    tryLoad(0)
    return () => {
      live = false
    }
  }, [appKey])
  return <span className="app-icon">{src ? <img src={src} alt="" /> : name.slice(0, 1).toUpperCase()}</span>
}

/**
 * Keeps rows where the eye left them: the list re-ranks at most every 10 seconds, and never
 * while the pointer is over it. New apps join at the end until the next re-rank.
 */
function useStableOrder(apps: AppRow[], frozen: boolean): AppRow[] {
  const order = useRef<string[]>([])
  const last = useRef(0)
  const byKey = new Map(apps.map((a) => [a.key, a]))
  const now = Date.now()
  if (!frozen && now - last.current > RESORT_MS) {
    order.current = apps.map((a) => a.key)
    last.current = now
  } else {
    const known = new Set(order.current)
    order.current = order.current.filter((k) => byKey.has(k)).concat(apps.filter((a) => !known.has(a.key)).map((a) => a.key))
  }
  return order.current.map((k) => byKey.get(k)!).filter(Boolean)
}

export function AppsTable(props: { snap: Snapshot; selected: string | null; onOpen: (key: string) => void; monitorOnly: boolean }) {
  const { snap } = props
  const [hovering, setHovering] = useState(false)
  const rows = useStableOrder(snap.apps, hovering)
  const total = snap.sys.totalPhys
  const appCount = snap.apps.length + snap.rest.count

  return (
    <section className="panel apps" aria-labelledby="apps-title">
      <div className="panel-head">
        <h2 className="panel-title" id="apps-title">
          Apps
        </h2>
        <span className="panel-note num">
          {snap.processCount} processes in {appCount} apps
        </span>
        <span
          className="panel-note spacer"
          title="Private memory is RAM only that app uses. Shared memory and Windows' file cache are left out, so the list adds up to less than “in use”."
        >
          Ranked by private memory
        </span>
      </div>
      {rows.length === 0 ? (
        <p className="empty" style={{ padding: '18px 22px 22px' }}>
          {snap.error ? 'The process list could not be read. R.R. will keep trying every few seconds.' : 'Reading running apps…'}
        </p>
      ) : (
        <table onPointerEnter={() => setHovering(true)} onPointerLeave={() => setHovering(false)}>
          <thead>
            <tr>
              <th scope="col">App</th>
              <th scope="col" className="right col-procs">
                Processes
              </th>
              <th scope="col" className="right">
                Private memory
              </th>
              <th scope="col" className="col-seal">
                Seal
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((a) => (
              <tr
                key={a.key}
                className={`row${a.titan ? ' is-titan' : ''}${props.selected === a.key ? ' selected' : ''}`}
                onClick={() => props.onOpen(a.key)}
              >
                <td>
                  <div className="app-cell">
                    <AppIcon appKey={a.key} name={a.description ?? a.name} />
                    <div className="app-name">
                      <button type="button" onClick={(e) => (e.stopPropagation(), props.onOpen(a.key))}>
                        {a.description ?? a.name}
                      </button>
                      <span className="tag">
                        {a.description ? a.name : ''}
                        {a.critical ? `${a.description ? ', ' : ''}part of Windows` : a.access === 'none' && !props.monitorOnly ? `${a.description ? ', ' : ''}no access` : ''}
                      </span>
                    </div>
                    {a.titan && (
                      <span className="titan" title="A Titan: holding at least 10% of your RAM.">
                        Titan
                      </span>
                    )}
                  </div>
                </td>
                <td className="right num col-procs">{a.processCount}</td>
                <td className="right">
                  <div className="mem-cell">
                    <span className="mem-bar" aria-hidden="true">
                      <i style={{ transform: `scaleX(${total ? Math.min(1, a.privateWs / total) : 0})` } as CSSProperties} />
                    </span>
                    <span className="mem-value">{formatBytes(a.privateWs)}</span>
                  </div>
                </td>
                <td className="col-seal">
                  {a.seal ? (
                    <SealPill seal={a.seal} />
                  ) : (
                    <span className="tag" aria-label="No seal">
                      —
                    </span>
                  )}
                </td>
              </tr>
            ))}
            {snap.rest.count > 0 && (
              <tr className="rest">
                <td>{snap.rest.count} smaller apps</td>
                <td className="col-procs" />
                <td className="right num">{formatBytes(snap.rest.privateWs)}</td>
                <td className="col-seal" />
              </tr>
            )}
          </tbody>
        </table>
      )}
    </section>
  )
}

export function SealPill({ seal }: { seal: NonNullable<AppRow['seal']> }) {
  const s = seal.state.state
  const cls = s === 'enforced' ? 'ok' : s === 'partial' ? 'warn' : s === 'unsupported' ? 'bad' : s === 'watching' ? (seal.over ? 'warn' : 'hollow') : 'hollow'
  // Wherever R.R. is only watching (all of the app, or the part Windows refused), say when it is over.
  const label = !seal.over
    ? seal.state.label
    : s === 'watching'
      ? 'Over, watching only'
      : s === 'partial' || s === 'unsupported'
        ? `${seal.state.label}, over`
        : seal.state.label
  return (
    <span className={`pill ${cls}`} title={seal.state.detail}>
      {label}
    </span>
  )
}
