import { useEffect, useRef, useState } from 'react'
import { formatBytes, formatDelta, MB } from '../../shared/format'
import type { Echo } from '../../shared/ipc'
import { CloseGlyph, Scramble } from './ui'

const KIND: Record<Echo['kind'], string> = {
  roaring: 'Roaring',
  titan: 'Titan',
  seal: 'Seal',
  close: 'Close request',
  watch: 'Watch',
  waterline: 'Waterline',
  error: 'Error'
}

/** Echoes: a quiet record of what R.R. did, what it measured, and what it could not do. */
export function Echoes(props: { echoes: Echo[]; onClear: () => void; onHide: () => void; id: string }) {
  const seen = useRef<Set<string> | null>(null)
  if (seen.current === null) seen.current = new Set(props.echoes.map((e) => e.id))
  const [confirm, setConfirm] = useState(false)

  useEffect(() => {
    const t = window.setTimeout(() => props.echoes.forEach((e) => seen.current!.add(e.id)), 600)
    return () => window.clearTimeout(t)
  }, [props.echoes])

  return (
    <aside className="echoes" id={props.id} aria-labelledby="echoes-title">
      <div className="echoes-head">
        <h2 className="echoes-title" id="echoes-title">
          Echoes
        </h2>
        <span className="panel-note">Activity</span>
        <span style={{ marginLeft: 'auto', display: 'flex', gap: 2 }}>
          {props.echoes.length > 0 &&
            (confirm ? (
              <button
                className="btn quiet small"
                onClick={() => {
                  props.onClear()
                  setConfirm(false)
                }}
              >
                Clear all?
              </button>
            ) : (
              <button className="btn quiet small" onClick={() => setConfirm(true)} onBlur={() => setConfirm(false)}>
                Clear
              </button>
            ))}
          <button className="icon-btn" onClick={props.onHide} aria-label="Hide Echoes">
            <CloseGlyph />
          </button>
        </span>
      </div>
      <ol className="echoes-list">
        {props.echoes.length === 0 ? (
          <li className="empty">
            Nothing yet. When you run The Roaring or Titan, or change a seal or the waterline, it is recorded here with what
            it changed and anything Windows refused.
          </li>
        ) : (
          props.echoes.map((e) => <EchoItem key={e.id} echo={e} fresh={!seen.current!.has(e.id)} />)
        )}
      </ol>
    </aside>
  )
}

function EchoItem({ echo, fresh }: { echo: Echo; fresh: boolean }) {
  const [open, setOpen] = useState(false)
  const d = echo.change ? echo.change.after - echo.change.before : 0
  const time = new Date(echo.t)
  const back = echo.change && echo.rebound ? echo.rebound.after - echo.change.after : null
  return (
    <li className="echo">
      <div className="echo-top">
        <span className="echo-kind">
          <Scramble text={KIND[echo.kind]} active={fresh} />
        </span>
        <time className="echo-time" dateTime={time.toISOString()} title={time.toLocaleString()}>
          {time.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
        </time>
      </div>
      <p className="echo-title">{echo.title}</p>
      {echo.change && (
        <p className="echo-change">
          <span className={`delta ${d < 0 ? 'down' : 'up'}`}>{formatDelta(d)}</span>
          <span className="tag">
            {echo.change.label} {formatBytes(echo.change.before)} to {formatBytes(echo.change.after)}
          </span>
        </p>
      )}
      {echo.rebound && echo.change && (
        <p className="tag num">
          {echo.rebound.exited
            ? 'By the 30 s check, the app had exited.'
            : `30 s later: ${echo.change.label.toLowerCase()} ${formatBytes(echo.rebound.after)}${
                back != null && Math.abs(back) >= MB ? ` (${formatDelta(back)} since)` : ', unchanged'
              }`}
        </p>
      )}
      {echo.lines.length > 0 && (
        <div className="echo-lines">
          {echo.lines.slice(0, open ? undefined : 1).map((l) => (
            <span key={l}>{l}</span>
          ))}
        </div>
      )}
      {open && echo.limits.length > 0 && (
        <ul className="echo-limits">
          {echo.limits.map((l) => (
            <li key={l}>{l}</li>
          ))}
        </ul>
      )}
      {(echo.lines.length > 1 || echo.limits.length > 0) && (
        <button className="echo-more" onClick={() => setOpen(!open)} aria-expanded={open}>
          {open ? 'Less' : echo.limits.length ? `Details and limits (${echo.limits.length})` : 'Details'}
        </button>
      )}
    </li>
  )
}
