import { useEffect, useState } from 'react'
import { formatBytes, formatDelta, GB, MB, parseSize, type SizeUnit } from '../../shared/format'
import type { AppDetail, AppRow, Capabilities, Echo, Snapshot } from '../../shared/ipc'
import { checkSeal, sealMetric, type SealMode } from '../../shared/seals'
import type { AppGroup } from '../../shared/types'
import { AppIcon, SealPill } from './AppsTable'
import { BladeButton, BladeGlyph, CloseGlyph, Dialog } from './ui'

const MODES: { mode: SealMode; title: string; short: string; consequence: string }[] = [
  {
    mode: 'watch',
    title: 'Watch',
    short: 'Flag it. Nothing enforced.',
    consequence: 'R.R. marks the app and notes it in Echoes when it goes over. Windows does not limit it in any way.'
  },
  {
    mode: 'ceiling',
    title: 'Ceiling',
    short: 'Per process. Slows, keeps running.',
    consequence:
      'Windows keeps each of its processes at or under this much resident RAM by paging the rest out. The app keeps working but can become slow. It is not a share of a total: every process gets the full value. Ceilings are lifted when R.R. quits.'
  },
  {
    mode: 'cap',
    title: 'Hard cap',
    short: 'Whole app. Allocations fail.',
    consequence:
      'Windows refuses new allocations once the whole app has this much committed. Apps often show errors or close when that happens, and unsaved work can be lost. A process can never leave the cap’s job; removing the seal only lifts the limit.'
  }
]

export function AppDrawer(props: {
  appKey: string | null
  snap: Snapshot
  caps: Capabilities
  onClose: () => void
  onEcho: (echo: Echo | undefined, error?: string) => void
}) {
  const key = props.appKey
  const [detail, setDetail] = useState<AppDetail | null>(null)
  // Keep the last known row so the drawer can still show it if the app exits while open.
  const [last, setLast] = useState<AppRow | null>(null)

  // Detail is looked up by key, so an app that shrinks out of the main list stays in view here.
  useEffect(() => {
    setDetail(null)
    if (!key) return
    let live = true
    const load = () => void window.rr.appDetail(key).then((d) => live && setDetail(d))
    load()
    const id = window.setInterval(load, 2000)
    return () => {
      live = false
      window.clearInterval(id)
    }
  }, [key])

  const listed = key ? props.snap.apps.find((a) => a.key === key) ?? null : null
  const current = listed ?? (detail?.key === key ? detail.row : null)
  useEffect(() => {
    if (current) setLast(current)
  }, [current])
  // While closing, keep showing the last app so the panel never empties before it slides out.
  const row = current ?? (key ? (last?.key === key ? last : null) : last)
  const running = !!listed || (detail?.key === key && !!detail.row) || detail === null

  return (
    <Dialog open={!!key} onClose={props.onClose} variant="drawer" labelledBy="drawer-title">
      {row && <DrawerBody key={row.key} row={row} running={running} detail={detail?.key === key ? detail : null} {...props} />}
    </Dialog>
  )
}

function DrawerBody(props: {
  row: AppRow
  running: boolean
  detail: AppDetail | null
  snap: Snapshot
  caps: Capabilities
  onClose: () => void
  onEcho: (echo: Echo | undefined, error?: string) => void
}) {
  const { row, caps, snap, detail } = props
  const [titanId, setTitanId] = useState<string | null>(null)
  const [titanFallback, setTitanFallback] = useState<Echo | null>(null)
  // Follow the Echo itself, so the 30 s recheck shows up here too.
  const titan = (titanId ? snap.echoes.find((e) => e.id === titanId) : null) ?? titanFallback
  const [confirmClose, setConfirmClose] = useState(false)

  const name = row.description ?? row.name
  const busy = !!snap.busy
  const titanBlocked = !caps.trim
    ? `${caps.platformName} gives R.R. no supported way to trim another app.`
    : row.critical
      ? 'Part of Windows. R.R. leaves Windows components alone.'
      : row.access === 'none'
        ? 'Windows denied R.R. access (it runs as administrator, as another user, or is protected).'
        : !props.running
          ? 'The app is no longer running.'
          : null

  const accessLine = row.critical
    ? 'Part of Windows. R.R. only watches it.'
    : !caps.trim
      ? 'Monitoring only on this system.'
      : row.access === 'full'
        ? `R.R. can act on all ${row.processCount === 1 ? 'of it' : `${row.processCount} of its processes`}.`
        : row.access === 'partial'
          ? 'Windows lets R.R. act on some of its processes, not all.'
          : 'Windows denies R.R. access, so it can only watch.'

  const runTitan = async () => {
    const r = await window.rr.runTitan(row.key).catch((e: Error) => ({ ok: false, error: e.message, echo: undefined }))
    if (r.echo) {
      setTitanId(r.echo.id)
      setTitanFallback(r.echo)
    }
    props.onEcho(r.echo, r.error)
  }

  return (
    <>
      <div className="drawer-head">
        <AppIcon appKey={row.key} name={name} />
        <div style={{ minWidth: 0 }}>
          <h2 className="drawer-title" id="drawer-title">
            {name}
          </h2>
          <span className="tag">
            {row.name}
            {!props.running && ', no longer running'}
          </span>
        </div>
        <button className="icon-btn" onClick={props.onClose} aria-label="Close details">
          <CloseGlyph />
        </button>
      </div>

      <div className="section">
        <dl className="facts">
          <div>
            <dt>Private memory</dt>
            <dd>{formatBytes(row.privateWs)}</dd>
          </div>
          <div title="Includes pages shared with other apps, so these overlap between apps.">
            <dt>Working set, incl. shared</dt>
            <dd>{formatBytes(row.workingSet)}</dd>
          </div>
          <div title="Memory the app has reserved. This is what a hard cap counts.">
            <dt>Committed</dt>
            <dd>{caps.cap ? formatBytes(row.commit) : '—'}</dd>
          </div>
          <div>
            <dt>Processes</dt>
            <dd>{row.processCount}</dd>
          </div>
        </dl>
        <p className="waterline-msg">
          {accessLine}
          {row.titan ? ' It is a Titan: it holds at least 10% of your RAM.' : ''}
        </p>
      </div>

      <div className="section" aria-labelledby="titan-title">
        <h3 className="section-title display" id="titan-title">
          Titan
        </h3>
        <p className="waterline-msg">
          Trims this app’s working set once. Windows moves its pages into the cache; the app pulls back what it actually
          uses, so part of the drop returns. Its committed memory does not change: only the app can free that.
        </p>
        <div>
          <BladeButton onClick={runTitan} disabled={busy || !!titanBlocked}>
            <BladeGlyph />
            {snap.busy === 'Titan' ? 'Trimming…' : 'Run Titan'}
          </BladeButton>
        </div>
        {titanBlocked && <p className="tag">No supported action: {titanBlocked}</p>}
        {titan?.change && <TitanResult echo={titan} />}
        {titan && !titan.change && <p className="field-warn">{titan.limits[0]}</p>}
      </div>

      <SealEditor row={row} detail={detail} snap={snap} caps={caps} onEcho={props.onEcho} />

      {caps.askToClose && row.hasWindows && props.running && (
        <div className="section">
          <h3 className="section-title">Ask to close</h3>
          <p className="waterline-msg">
            Sends the same request as clicking its close button. The app decides what happens: it may ask you to save first.
            R.R. never ends apps.
          </p>
          <div>
            <button className="btn danger" onClick={() => setConfirmClose(true)}>
              Ask {name} to close…
            </button>
          </div>
        </div>
      )}

      <div className="section">
        <details>
          <summary>
            {row.processCount} process{row.processCount === 1 ? '' : 'es'}
          </summary>
          {detail && (
            <table className="proc-table" style={{ marginTop: 8 }}>
              <thead>
                <tr>
                  <th scope="col">PID</th>
                  <th scope="col">Private</th>
                  <th scope="col">Working set</th>
                  <th scope="col">Committed</th>
                  <th scope="col">Access</th>
                </tr>
              </thead>
              <tbody>
                {detail.processes.slice(0, 60).map((p) => (
                  <tr key={p.pid}>
                    <td>{p.pid}</td>
                    <td>{formatBytes(p.privateWs)}</td>
                    <td>{formatBytes(p.workingSet)}</td>
                    <td>{caps.cap ? formatBytes(p.commit) : '—'}</td>
                    <td>{p.critical ? 'Windows' : p.access === 'trim' ? 'Yes' : 'Denied'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {detail?.path && (
            <p className="tag" style={{ marginTop: 8, overflowWrap: 'anywhere' }}>
              {detail.path}
            </p>
          )}
        </details>
      </div>

      <Dialog open={confirmClose} onClose={() => setConfirmClose(false)} variant="modal" labelledBy="close-title">
        <h2 className="dialog-title" id="close-title">
          Ask {name} to close?
        </h2>
        <p className="dialog-lede">
          R.R. will send a close request to its {detail?.closableWindows ?? ''} window{detail?.closableWindows === 1 ? '' : 's'}, the same as
          clicking the close button. If there is unsaved work, the app should ask you about it. Some apps keep running in the
          tray instead.
        </p>
        <div className="dialog-actions">
          <button className="btn" onClick={() => setConfirmClose(false)} autoFocus>
            Cancel
          </button>
          <BladeButton
            className="btn danger"
            onClick={async () => {
              const r = await window.rr.askToClose(row.key).catch((e: Error) => ({ ok: false, error: e.message, echo: undefined }))
              props.onEcho(r.echo, r.error)
              setConfirmClose(false)
            }}
          >
            Ask to close
          </BladeButton>
        </div>
      </Dialog>
    </>
  )
}

function TitanResult({ echo }: { echo: Echo }) {
  const c = echo.change!
  const delta = c.after - c.before
  return (
    <div role="status">
      <dl className="result">
        <div className="result-col">
          <dt>Before</dt>
          <dd>{formatBytes(c.before)}</dd>
        </div>
        <span className="result-arrow" aria-hidden="true">
          to
        </span>
        <div className="result-col">
          <dt>After</dt>
          <dd>{formatBytes(c.after)}</dd>
        </div>
      </dl>
      <p className={`delta ${delta < 0 ? 'down' : 'up'}`}>
        {formatDelta(delta)} private memory, measured just after.
        {echo.rebound ? ` 30 s later: ${formatBytes(echo.rebound.after)}.` : ' R.R. checks again in 30 s.'}
      </p>
      <ul className="echo-limits" style={{ marginTop: 8 }}>
        {echo.limits.map((l) => (
          <li key={l}>{l}</li>
        ))}
      </ul>
    </div>
  )
}

function SealEditor(props: {
  row: AppRow
  detail: AppDetail | null
  snap: Snapshot
  caps: Capabilities
  onEcho: (echo: Echo | undefined, error?: string) => void
}) {
  const { row, detail, snap, caps } = props
  const seal = row.seal
  const largestWs = detail ? Math.max(0, ...detail.processes.map((p) => p.workingSet)) : row.workingSet
  const [mode, setMode] = useState<SealMode>(seal?.mode ?? 'watch')
  const suggest = (m: SealMode) => {
    const basis = m === 'cap' ? row.commit * 1.25 : m === 'ceiling' ? largestWs : row.privateWs * 1.2
    return Math.max(0.5, Math.ceil(basis / (GB / 2)) / 2)
  }
  // Sizes under 1 GB are edited in MB, so a 64 MB seal saves again as 64 MB.
  const [text, setText] = useState(() =>
    seal ? (seal.bytes < GB ? String(Math.round(seal.bytes / MB)) : gbText(seal.bytes / GB)) : String(suggest(mode))
  )
  const [unit, setUnit] = useState<SizeUnit>(seal && seal.bytes < GB ? 'MB' : 'GB')
  const [acceptRisk, setAcceptRisk] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const bytes = parseSize(text, unit)
  const group = { ...row, pids: [] } as AppGroup
  const check = bytes == null ? null : checkSeal(mode, bytes, group, snap.sys.totalPhys, largestWs)
  const needsRisk = mode === 'cap' && bytes != null && bytes < row.commit
  const enforceable = (m: SealMode) => m === 'watch' || (caps[m] && !row.critical && row.access !== 'none')
  const metric = sealMetric(mode)
  // A cap reports what Windows counts: everything inside its job.
  const capCommit = seal?.mode === 'cap' && mode === 'cap' ? seal.capCommit : undefined
  const current = metric === 'commit' ? capCommit ?? row.commit : metric === 'workingSet' ? largestWs : row.privateWs
  const currentLabel =
    metric === 'commit'
      ? capCommit != null
        ? 'Committed in the cap now'
        : 'Committed now'
      : metric === 'workingSet'
        ? 'Largest process now'
        : 'Private memory now'
  const locked = snap.seals.find((s) => s.key === row.key)?.locked ?? 0

  const save = async () => {
    if (bytes == null) return setError('Enter a size, like 4 GB.')
    if (check?.error) return setError(check.error)
    if (needsRisk && !acceptRisk) return setError('Confirm that you understand the app may close.')
    setSaving(true)
    try {
      const r = await window.rr.saveSeal({ key: row.key, mode, bytes, acceptRisk })
      if (!r.ok) setError(r.error === 'risk' ? 'Confirm that you understand the app may close.' : r.error ?? 'Could not save the seal.')
      else {
        setError(null)
        props.onEcho(r.echo)
      }
    } catch (e) {
      setError(`Could not save the seal: ${(e as Error).message}`)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="section" aria-labelledby="seal-title">
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <h3 className="section-title display" id="seal-title">
          Seal
        </h3>
        {seal && <SealPill seal={seal} />}
      </div>
      <p className="waterline-msg">A memory limit for this app. Choose how strictly it holds.</p>
      {seal && <p className="tag">{seal.state.detail}</p>}
      {seal?.also && seal.also.length > 0 && (
        <p className="field-warn">
          Also inside this cap: {seal.also.join(', ')}. The app placed them there itself, so they share the limit.
        </p>
      )}
      {locked > 0 && (
        <p className="field-warn">
          {locked} of its processes still carry a cap from an earlier R.R. session. Windows keeps that one until they exit, and
          R.R. can no longer change it.
        </p>
      )}

      <fieldset className="modes" style={{ border: 0, padding: 0, margin: 0 }}>
        <legend className="sr-only">Kind of seal</legend>
        {MODES.map((m) => (
          <label key={m.mode} className="mode">
            <input
              type="radio"
              name="seal-mode"
              value={m.mode}
              checked={mode === m.mode}
              disabled={!enforceable(m.mode)}
              onChange={() => {
                setMode(m.mode)
                setError(null)
                setAcceptRisk(false)
                if (!seal) setText(String(suggest(m.mode)))
              }}
            />
            <strong>{m.title}</strong>
            {enforceable(m.mode) ? m.short : m.mode !== 'watch' && !caps[m.mode] ? `Not available on ${caps.platformName}.` : 'Windows won’t allow it here.'}
          </label>
        ))}
      </fieldset>
      <p className="consequence">{MODES.find((m) => m.mode === mode)!.consequence}</p>

      <form
        className="inline-form"
        onSubmit={(e) => {
          e.preventDefault()
          void save()
        }}
      >
        <label htmlFor="seal-size">Limit</label>
        <input
          id="seal-size"
          className="field"
          inputMode="decimal"
          value={text}
          onChange={(e) => {
            setText(e.target.value)
            setError(null)
          }}
          aria-invalid={!!error}
          aria-describedby="seal-current"
        />
        <select className="field" value={unit} onChange={(e) => setUnit(e.target.value as SizeUnit)} aria-label="Unit">
          <option>GB</option>
          <option>MB</option>
        </select>
        <span className="tag" id="seal-current">
          {currentLabel}: {formatBytes(current)}
        </span>
      </form>

      {check?.warnings.map((w) => (
        <p key={w} className="field-warn">
          {w}
        </p>
      ))}
      {needsRisk && (
        <label className="check">
          <input type="checkbox" checked={acceptRisk} onChange={(e) => setAcceptRisk(e.target.checked)} />
          <span>I understand {row.description ?? row.name} may show errors or close, and unsaved work may be lost.</span>
        </label>
      )}
      {error && (
        <p className="field-error" role="alert">
          {error}
        </p>
      )}

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {mode === 'watch' ? (
          <button className="btn primary" onClick={save} disabled={saving || bytes == null}>
            {seal ? 'Update seal' : 'Save seal'}
          </button>
        ) : (
          <BladeButton onClick={save} disabled={saving || bytes == null || !enforceable(mode)}>
            <BladeGlyph />
            {seal ? 'Update seal' : 'Apply seal'}
          </BladeButton>
        )}
        {seal && (
          <>
            <button
              className="btn"
              onClick={async () => {
                const r = await window.rr
                  .setSealEnabled(row.key, !seal.enabled)
                  .catch((e: Error) => ({ ok: false, error: e.message, echo: undefined }))
                props.onEcho(r.echo, r.ok ? undefined : r.error)
              }}
            >
              {seal.enabled ? 'Pause' : 'Resume'}
            </button>
            <button
              className="btn quiet"
              onClick={async () => {
                const r = await window.rr.removeSeal(row.key).catch((e: Error) => ({ ok: false, error: e.message, echo: undefined }))
                props.onEcho(r.echo, r.error)
              }}
            >
              Remove seal
            </button>
          </>
        )}
      </div>
      {mode !== 'watch' && <p className="tag">New processes of this app are sealed only while R.R. is running.</p>}
    </div>
  )
}

/** 4 → "4", 1.5 → "1.5", 0.25 → "0.25". */
function gbText(n: number): string {
  return n.toFixed(2).replace(/\.?0+$/, '')
}
