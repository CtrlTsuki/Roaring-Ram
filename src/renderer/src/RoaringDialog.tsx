import { useEffect, useState } from 'react'
import { formatBytes, formatDelta } from '../../shared/format'
import type { Capabilities, Echo, RoaringPreview } from '../../shared/ipc'
import { Fountain } from './Fountain'
import { BladeButton, BladeGlyph, Dialog } from './ui'

type Phase = 'preview' | 'running' | 'result'

/**
 * The Roaring: one pass of supported reclamation across every app R.R. can reach. The person sees
 * exactly what will and won't happen first; closing apps is opt-in, app by app.
 */
export function RoaringDialog(props: {
  open: boolean
  caps: Capabilities
  level: number
  onClose: () => void
  onBegin: () => void
  onEcho: (echo: Echo | undefined, error?: string) => void
}) {
  const [phase, setPhase] = useState<Phase>('preview')
  const [preview, setPreview] = useState<RoaringPreview | null>(null)
  const [close, setClose] = useState<Set<string>>(new Set())
  const [result, setResult] = useState<Echo | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!props.open) return
    setPhase('preview')
    setClose(new Set())
    setResult(null)
    setError(null)
    setPreview(null)
    void window.rr.previewRoaring().then(setPreview)
  }, [props.open])

  const begin = async () => {
    setPhase('running')
    props.onBegin()
    try {
      const r = await window.rr.runRoaring({ close: [...close] })
      props.onEcho(r.echo, r.error)
      if (r.ok && r.echo) {
        setResult(r.echo)
        setPhase('result')
        return
      }
      setError(r.error ?? 'The Roaring could not run.')
    } catch (e) {
      setError(`The Roaring could not run: ${(e as Error).message}`)
    }
    setPhase('preview')
  }

  const gap = preview && preview.target != null ? preview.used - preview.target : null
  const skippedWindows = preview?.skipped.find((s) => s.reason === 'windows')?.count ?? 0
  const skippedDenied = preview?.skipped.find((s) => s.reason === 'denied')?.count ?? 0

  return (
    <Dialog open={props.open} onClose={props.onClose} variant="modal" labelledBy="roaring-title" locked={phase === 'running'}>
      <h2 className="dialog-title" id="roaring-title">
        The Roaring
      </h2>

      {phase === 'running' && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 18 }}>
          {/* Forms as the cleanup begins. It shows that work is under way, never the result. */}
          <Fountain level={props.level} average={null} target={null} working surgeKey={0} small label="The Roaring is running." />
          <p className="dialog-lede" role="status">
            Trimming working sets and sending any close requests you chose, then measuring. This takes a few seconds.
          </p>
        </div>
      )}

      {phase === 'preview' && (
        <>
          <p className="dialog-lede">One pass across every app R.R. can reach, using only what Windows supports. Nothing runs until you begin.</p>

          {!props.caps.trim ? (
            <p className="banner">{props.caps.platformName} gives R.R. no supported way to reclaim memory from other apps, so The Roaring is not available here.</p>
          ) : !preview ? (
            <p className="tag">Looking at running apps…</p>
          ) : (
            <>
              <div className="section">
                <h3 className="section-title">What will happen</h3>
                <ul className="plain-list">
                  <li>
                    Trim the working sets of <span className="num">{preview.trimCount}</span> processes in{' '}
                    <span className="num">{preview.trimApps}</span> apps. Windows moves their pages into its cache.
                  </li>
                  <li>“In use” usually drops at once. Apps pull back what they really use, so part of it returns, and they may feel slow for a moment.</li>
                  <li>Pages an app has changed may be written to the page file first, so expect a short burst of disk activity.</li>
                  <li>R.R. measures before and after, then again 30 seconds later, and records it in Echoes.</li>
                </ul>
              </div>

              <div className="section">
                <h3 className="section-title">What won’t happen</h3>
                <ul className="plain-list wont">
                  <li>No app is ended, and nothing is closed unless you choose it below.</li>
                  <li>
                    <span className="num">{skippedWindows}</span> Windows components are left alone.
                  </li>
                  {skippedDenied > 0 && (
                    <li>
                      <span className="num">{skippedDenied}</span> processes are out of reach: Windows denies access (administrator, other users, or protected).
                    </li>
                  )}
                  <li>Windows’ standby cache is not purged. That needs administrator rights, and it already counts as available.</li>
                </ul>
              </div>

              {props.caps.askToClose && preview.closeCandidates.length > 0 && (
                <div className="section">
                  <h3 className="section-title" id="close-choice">
                    Also ask apps to close <span className="tag">(optional)</span>
                  </h3>
                  <p className="waterline-msg">
                    Closing an app is the only reliable way to free its memory. Each one gets a normal close request and may ask you
                    to save. None are chosen for you.
                  </p>
                  <div className="choices" role="group" aria-labelledby="close-choice">
                    {preview.closeCandidates.map((c) => (
                      <label key={c.key} className="choice">
                        <input
                          type="checkbox"
                          checked={close.has(c.key)}
                          onChange={(e) => {
                            const next = new Set(close)
                            if (e.target.checked) next.add(c.key)
                            else next.delete(c.key)
                            setClose(next)
                          }}
                        />
                        <span>
                          {c.description ?? c.name}
                          <small>
                            {c.windows} window{c.windows === 1 ? '' : 's'}
                          </small>
                        </span>
                        <span className="num tag">{formatBytes(c.privateWs)}</span>
                      </label>
                    ))}
                  </div>
                </div>
              )}

              {gap != null && (
                <p className={gap > 0 ? 'field-warn' : 'tag'}>
                  {gap > 0
                    ? `You are ${formatBytes(gap)} above your waterline. Trimming alone rarely closes a gap that size for long; closing apps does.`
                    : `You are already ${formatBytes(-gap)} under your waterline.`}
                </p>
              )}
            </>
          )}

          {error && (
            <p className="field-error" role="alert">
              {error}
            </p>
          )}

          <div className="dialog-actions">
            <button className="btn" onClick={props.onClose}>
              Cancel
            </button>
            <BladeButton onClick={begin} disabled={!preview || !props.caps.trim}>
              <BladeGlyph />
              {close.size ? `Begin, and ask ${close.size} to close` : 'Begin The Roaring'}
            </BladeButton>
          </div>
        </>
      )}

      {phase === 'result' && result?.change && <RoaringResult echo={result} onClose={props.onClose} />}
    </Dialog>
  )
}

function RoaringResult({ echo, onClose }: { echo: Echo; onClose: () => void }) {
  const c = echo.change!
  const delta = c.after - c.before
  return (
    <div role="status" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <dl className="result">
        <div className="result-col">
          <dt>In use before</dt>
          <dd>{formatBytes(c.before)}</dd>
        </div>
        <span className="result-arrow" aria-hidden="true">
          to
        </span>
        <div className="result-col">
          <dt>In use after</dt>
          <dd>{formatBytes(c.after)}</dd>
        </div>
      </dl>
      <p className={`delta ${delta < 0 ? 'down' : 'up'}`}>
        {formatDelta(delta)}, measured 1.5 s after. {delta > 0 ? 'Other apps were allocating at the same time.' : ''}
      </p>
      <ul className="plain-list">
        {echo.lines.map((l) => (
          <li key={l}>{l}</li>
        ))}
      </ul>
      <ul className="echo-limits">
        {echo.limits.map((l) => (
          <li key={l}>{l}</li>
        ))}
      </ul>
      <div className="dialog-actions">
        <button className="btn primary" onClick={onClose} autoFocus>
          Done
        </button>
      </div>
    </div>
  )
}
