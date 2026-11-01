import { useEffect, useRef, useState } from 'react'
import { formatBytes, formatDuration } from '../../shared/format'
import type { UsageAverage, UsageSample } from '../../shared/types'

const WINDOW_MS = 5 * 60_000
const H = 188
const PAD = { top: 10, right: 8, bottom: 22, left: 44 }

/** Memory in use over the last five minutes. One series, so no legend; the waterline is labelled on the chart. */
export function HistoryChart(props: { samples: UsageSample[]; now: number; total: number; target: number | null; average: UsageAverage | null }) {
  const box = useRef<HTMLDivElement>(null)
  const [w, setW] = useState(520)
  const [hover, setHover] = useState<number | null>(null)

  useEffect(() => {
    const el = box.current
    if (!el) return
    const ro = new ResizeObserver(([e]) => setW(Math.max(220, Math.round(e.contentRect.width))))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const { samples, now, total, target, average } = props
  // Until five minutes exist, the axis spans the time actually covered (and says so), rather than
  // squeezing a few seconds into a sliver at the right edge.
  const covered = samples.length ? now - samples[0].t : 0
  const span = Math.min(WINDOW_MS, Math.max(20_000, covered))
  const x0 = now - span
  const iw = w - PAD.left - PAD.right
  const ih = H - PAD.top - PAD.bottom
  const x = (t: number) => PAD.left + ((t - x0) / span) * iw
  const y = (b: number) => PAD.top + ih - (total ? (b / total) * ih : 0)

  const pts = samples.map((s) => [x(s.t), y(s.used)] as const)
  const line = pts.map(([px, py], i) => `${i ? 'L' : 'M'}${px.toFixed(1)},${py.toFixed(1)}`).join('')
  const area = pts.length ? `${line}L${pts[pts.length - 1][0].toFixed(1)},${y(0)}L${pts[0][0].toFixed(1)},${y(0)}Z` : ''
  const ticks = [0, 0.5, 1].map((f) => f * total)
  const hovered = hover != null ? samples[hover] : null

  const onMove = (e: React.PointerEvent<SVGSVGElement>) => {
    if (!samples.length) return
    const rect = e.currentTarget.getBoundingClientRect()
    const t = x0 + ((e.clientX - rect.left - PAD.left) / iw) * span
    let best = 0
    for (let i = 1; i < samples.length; i++) if (Math.abs(samples[i].t - t) < Math.abs(samples[best].t - t)) best = i
    setHover(best)
  }

  const summary = average
    ? `Over the last ${average.complete ? '5 minutes' : formatDuration(average.coveredMs)}, in use averaged ${formatBytes(average.usedBytes)} and peaked at ${formatBytes(average.peakBytes)}.`
    : 'Collecting the first samples.'

  return (
    <div className="chart">
      <div className="chart-head">
        <h2 className="chart-title" id="history-title">
          Last 5 minutes
        </h2>
        <span className="panel-note">{average && !average.complete ? `Collecting: ${formatDuration(average.coveredMs)} of 5 min` : 'Sampled every 2 s'}</span>
      </div>
      <div ref={box} style={{ position: 'relative' }}>
        <svg
          viewBox={`0 0 ${w} ${H}`}
          role="img"
          aria-labelledby="history-title history-summary"
          onPointerMove={onMove}
          onPointerLeave={() => setHover(null)}
        >
          <defs>
            <linearGradient id="chartFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor="#7fe6f5" stopOpacity="0.16" />
              <stop offset="1" stopColor="#7fe6f5" stopOpacity="0" />
            </linearGradient>
          </defs>
          <g className="grid">
            {ticks.map((b) => (
              <line key={b} x1={PAD.left} x2={w - PAD.right} y1={y(b)} y2={y(b)} />
            ))}
          </g>
          <g className="axis">
            {ticks.map((b) => (
              <text key={b} x={PAD.left - 8} y={y(b) + 4} textAnchor="end">
                {b === 0 ? '0' : formatBytes(b).replace(' GB', '')}
              </text>
            ))}
            <text x={PAD.left} y={H - 4}>
              {span >= WINDOW_MS ? '5 min ago' : `${formatDuration(span)} ago`}
            </text>
            <text x={w - PAD.right} y={H - 4} textAnchor="end">
              now
            </text>
          </g>
          {area && <path className="area" d={area} />}
          {line && <path className="series" d={line} />}
          {target != null && target < total && (
            <g className="target">
              <line x1={PAD.left} x2={w - PAD.right} y1={y(target)} y2={y(target)} />
              <text x={PAD.left + 6} y={y(target) - 6}>
                Waterline {formatBytes(target)}
              </text>
            </g>
          )}
          {hovered && (
            <g className="cursor">
              <line x1={x(hovered.t)} x2={x(hovered.t)} y1={PAD.top} y2={y(0)} />
              <circle cx={x(hovered.t)} cy={y(hovered.used)} r={4.5} />
            </g>
          )}
        </svg>
        {hovered && (
          <div className="chart-tip num" style={{ left: x(hovered.t), top: y(hovered.used) }}>
            {formatBytes(hovered.used)} at {new Date(hovered.t).toLocaleTimeString()}
          </div>
        )}
      </div>
      <p className="chart-summary" id="history-summary">
        {summary} Axis in GB.
      </p>
    </div>
  )
}
