import { useEffect, useState, type CSSProperties } from 'react'

const SPRAY = [
  { x: -26, y: -46, d: 0 },
  { x: -12, y: -70, d: 60 },
  { x: 2, y: -84, d: 20 },
  { x: 14, y: -64, d: 90 },
  { x: 28, y: -40, d: 40 },
  { x: -20, y: -28, d: 140 },
  { x: 20, y: -24, d: 120 },
  { x: -4, y: -56, d: 170 }
]

/**
 * The dark fountain: memory in use is the column; the dashed line is the waterline (target);
 * the short tick on the right is the five-minute average. The column only moves when a new
 * measurement arrives. It forms once at launch, and sprays when a cleanup begins; neither
 * animation is a measurement.
 */
export function Fountain(props: {
  level: number
  average: number | null
  target: number | null
  working: boolean
  surgeKey: number
  label: string
  small?: boolean
}) {
  const [forming, setForming] = useState(true)
  const [surging, setSurging] = useState(false)

  useEffect(() => {
    const t = window.setTimeout(() => setForming(false), 1100)
    return () => window.clearTimeout(t)
  }, [])

  useEffect(() => {
    if (!props.surgeKey) return
    setSurging(false)
    const raf = requestAnimationFrame(() => setSurging(true))
    const t = window.setTimeout(() => setSurging(false), 1200)
    return () => {
      cancelAnimationFrame(raf)
      window.clearTimeout(t)
    }
  }, [props.surgeKey])

  const level = clamp(props.level)
  const cls = ['fountain', props.small && 'small', forming && 'forming', surging && 'surging', props.working && 'working'].filter(Boolean).join(' ')
  return (
    <div className={cls} style={{ '--level': level } as CSSProperties} role="img" aria-label={props.label}>
      <div className="vessel">
        <div className="liquid" />
        <div className="surface" />
      </div>
      {props.target != null && <div className="mark-line" style={{ '--at': clamp(props.target) } as CSSProperties} />}
      {props.average != null && <div className="mark-line avg" style={{ '--at': clamp(props.average) } as CSSProperties} />}
      <div className="spray" aria-hidden="true">
        {SPRAY.map((s, i) => (
          <i key={i} style={{ '--x': `${s.x}px`, '--y': `${s.y}px`, '--d': `${s.d}ms` } as CSSProperties} />
        ))}
      </div>
    </div>
  )
}

function clamp(n: number): number {
  return Math.max(0, Math.min(1, n || 0))
}
