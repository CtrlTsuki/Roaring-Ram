import { useState } from 'react'
import { formatBytes, formatPercent, GB, parseSize, type SizeUnit } from '../../shared/format'
import type { Snapshot } from '../../shared/ipc'
import { checkWaterline } from '../../shared/waterline'
import { Fountain } from './Fountain'
import { HistoryChart } from './HistoryChart'

/** Pulse: the live answer to "how much RAM is in use, and is it more than I want?" */
export function Pulse(props: { snap: Snapshot; surgeKey: number; onWaterline: (bytes: number | null) => Promise<string | null> }) {
  const { snap } = props
  const { sys, average } = snap
  const total = sys.totalPhys
  const frac = total ? sys.used / total : 0
  const target = snap.waterline?.target ?? null
  const [usedWhole, usedDec] = formatBytes(sys.used).replace(' GB', '').split('.')
  const reserved = sys.installed && sys.installed > total ? sys.installed - total : 0

  return (
    <section className="panel pulse" aria-labelledby="pulse-title">
      <Fountain
        level={frac}
        average={average ? average.fraction : null}
        target={target != null && total ? target / total : null}
        working={!!snap.busy}
        surgeKey={props.surgeKey}
        label={`Memory in use: ${formatPercent(frac)} of usable RAM${target != null ? `, waterline at ${formatPercent(target / total)}` : ''}.`}
      />

      <div className="figures">
        <h1 id="pulse-title" className="sr-only">
          Pulse: memory in use now
        </h1>
        <div className="hero-line">
          <span className="hero-figure" aria-hidden="true">
            {sys.used >= GB ? (
              <>
                {usedWhole}
                <span style={{ opacity: 0.55 }}>.{usedDec}</span>
              </>
            ) : (
              formatBytes(sys.used).replace(' MB', '')
            )}
          </span>
          <span className="hero-unit" aria-hidden="true">
            {sys.used >= GB ? 'GB' : 'MB'} in use
          </span>
          <span className="sr-only">{formatBytes(sys.used)} in use</span>
        </div>
        <p className="hero-sub">
          <strong className="num">{formatPercent(frac)}</strong> of {formatBytes(total)} usable
          {sys.installed ? (
            <>
              {' '}
              ({formatBytes(sys.installed)} installed{reserved >= 0.05 * GB ? `, ${formatBytes(reserved)} reserved by hardware` : ''})
            </>
          ) : null}
        </p>
        <dl className="stats">
          <div className="stat" title="Free memory plus cache that Windows hands back the moment an app needs it.">
            <dt>Available</dt>
            <dd>
              {formatBytes(sys.availPhys)}
              {sys.cache > 0 && <small>incl. cache</small>}
            </dd>
          </div>
          <div className="stat">
            <dt>{average?.complete ? '5-minute average' : 'Average so far'}</dt>
            <dd>
              {average ? formatBytes(average.usedBytes) : '—'}
              {average && <small>{formatPercent(average.fraction)}</small>}
            </dd>
          </div>
          <div className="stat">
            <dt>Peak, last 5 minutes</dt>
            <dd>{average ? formatBytes(average.peakBytes) : '—'}</dd>
          </div>
          <div className="stat" title="Memory apps have reserved, backed by RAM or the page file. Running out of commit is what makes apps fail.">
            <dt>Committed</dt>
            <dd>
              {sys.commitLimit ? (
                <>
                  {formatBytes(sys.commitTotal)}
                  <small>of {formatBytes(sys.commitLimit)}</small>
                </>
              ) : (
                '—'
              )}
            </dd>
          </div>
        </dl>
        <Waterline snap={snap} onSave={props.onWaterline} />
      </div>

      <HistoryChart samples={snap.history} now={snap.t} total={total} target={target} average={average} />
    </section>
  )
}

function Waterline(props: { snap: Snapshot; onSave: (bytes: number | null) => Promise<string | null> }) {
  const { snap } = props
  const w = snap.waterline
  const [editing, setEditing] = useState(false)
  const [text, setText] = useState('')
  const [unit, setUnit] = useState<SizeUnit>('GB')
  const [error, setError] = useState<string | null>(null)
  const parsed = parseSize(text, unit)
  const check = parsed == null ? null : checkWaterline(parsed, snap.sys.totalPhys)

  const start = () => {
    setText(w ? (w.target / GB).toFixed(1).replace(/\.0$/, '') : String(Math.round((snap.sys.totalPhys * 0.65) / GB)))
    setUnit('GB')
    setError(null)
    setEditing(true)
  }

  const save = async () => {
    if (parsed == null) return setError('Enter a number, like 10.')
    if (check?.error) return setError(check.error)
    const err = await props.onSave(parsed)
    if (err) setError(err)
    else setEditing(false)
  }

  if (editing) {
    return (
      <div className="waterline">
        <form
          className="inline-form"
          onSubmit={(e) => {
            e.preventDefault()
            void save()
          }}
        >
          <label htmlFor="wl-size" className="waterline-name">
            Waterline
          </label>
          <input
            id="wl-size"
            className="field"
            inputMode="decimal"
            value={text}
            autoFocus
            onChange={(e) => {
              setText(e.target.value)
              setError(null)
            }}
            aria-describedby="wl-help"
            aria-invalid={!!error}
          />
          <select className="field" value={unit} onChange={(e) => setUnit(e.target.value as SizeUnit)} aria-label="Unit">
            <option>GB</option>
            <option>MB</option>
          </select>
          <button className="btn primary small" type="submit">
            Save
          </button>
          <button className="btn quiet small" type="button" onClick={() => setEditing(false)}>
            Cancel
          </button>
        </form>
        {error ? (
          <p className="field-error" role="alert">
            {error}
          </p>
        ) : check?.warnings.length ? (
          <p className="field-warn">{check.warnings[0]}</p>
        ) : null}
        <p className="waterline-msg" id="wl-help">
          The most RAM you want in use at once. R.R. measures against it and works toward it; Windows has no setting that
          caps total memory, so nothing is enforced.
        </p>
      </div>
    )
  }

  if (!w) {
    return (
      <div className="waterline">
        <div className="waterline-row">
          <span className="waterline-name">No waterline</span>
          <button className="btn small" onClick={start}>
            Set waterline
          </button>
        </div>
        <p className="waterline-msg">Set a target for total RAM use, like 10 GB of 16 GB, and R.R. shows how far you are from it.</p>
      </div>
    )
  }

  const a = w.assessment
  const pill =
    a.state === 'met' ? (
      <span className="pill ok num">{formatBytes(-a.gap)} under</span>
    ) : a.state === 'above' ? (
      <span className="pill warn num">{formatBytes(a.gap)} above</span>
    ) : (
      <span className="pill bad">Out of reach right now</span>
    )
  return (
    <div className="waterline">
      <div className="waterline-row">
        <span className="waterline-name num">Waterline {formatBytes(w.target)}</span>
        {pill}
        <span style={{ marginLeft: 'auto', display: 'flex', gap: 4 }}>
          <button className="btn quiet small" onClick={start}>
            Edit
          </button>
          <button className="btn quiet small" onClick={() => void props.onSave(null)}>
            Clear
          </button>
        </span>
      </div>
      <p className="waterline-msg">{a.message}</p>
    </div>
  )
}
