import { useCallback, useEffect, useRef, useState } from 'react'
import type { Capabilities, Echo, Snapshot } from '../../shared/ipc'
import { AppDrawer } from './AppDrawer'
import { AppsTable } from './AppsTable'
import { Echoes } from './Echoes'
import { Pulse } from './Pulse'
import { RoaringDialog } from './RoaringDialog'
import { BladeGlyph, Mark, PanelGlyph, useMediaQuery } from './ui'

const ECHOES_KEY = 'rr.echoes.open'

export function App() {
  const [snap, setSnap] = useState<Snapshot | null>(null)
  const [caps, setCaps] = useState<Capabilities | null>(null)
  const [selected, setSelected] = useState<string | null>(null)
  const [roaring, setRoaring] = useState(false)
  const [surgeKey, setSurgeKey] = useState(0)
  const [status, setStatus] = useState<string | null>(null)
  // Wide windows: Echoes is a sidebar whose open state is remembered. Narrow windows: it is an
  // overlay that starts closed and is summoned when wanted.
  const narrow = useMediaQuery('(max-width: 1180px)')
  const [sidebarOpen, setSidebarOpen] = useState(() => {
    try {
      return localStorage.getItem(ECHOES_KEY) !== '0'
    } catch {
      return true
    }
  })
  const [overlayOpen, setOverlayOpen] = useState(false)
  const echoesOpen = narrow ? overlayOpen : sidebarOpen
  const setEchoesOpen = (open: boolean) => (narrow ? setOverlayOpen(open) : setSidebarOpen(open))
  const statusTimer = useRef<number>(0)

  useEffect(() => {
    void window.rr.capabilities().then(setCaps)
    void window.rr.snapshot().then(setSnap)
    return window.rr.onSnapshot(setSnap)
  }, [])

  useEffect(() => {
    try {
      localStorage.setItem(ECHOES_KEY, sidebarOpen ? '1' : '0')
    } catch {
      /* per-viewer convenience only */
    }
  }, [sidebarOpen])

  useEffect(() => {
    if (!narrow || !overlayOpen) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOverlayOpen(false)
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [narrow, overlayOpen])

  /** One polite status line for finished actions; the live figures themselves are never announced. */
  const onEcho = useCallback((echo: Echo | undefined, error?: string) => {
    window.clearTimeout(statusTimer.current)
    setStatus(error ?? (echo ? `${echo.title}. ${echo.ok ? 'Recorded in Echoes.' : echo.limits[0] ?? ''}` : null))
    statusTimer.current = window.setTimeout(() => setStatus(null), 5000)
  }, [])

  const saveWaterline = useCallback(
    async (bytes: number | null) => {
      const r = await window.rr.setWaterline(bytes)
      if (r.ok) onEcho(r.echo)
      return r.ok ? null : r.error ?? 'Could not save.'
    },
    [onEcho]
  )

  if (!snap || !caps) {
    return (
      <div className="shell">
        <header className="titlebar">
          <div className="brand">
            <Mark />
            <span className="brand-name">R.R.</span>
          </div>
        </header>
        <p className="empty" style={{ padding: 26 }}>
          Reading memory…
        </p>
      </div>
    )
  }

  const monitorOnly = !caps.trim
  const ready = snap.sys.totalPhys > 0

  return (
    <div className="shell">
      <header className="titlebar">
        <div className="brand">
          <Mark />
          <span className="brand-name">R.R.</span>
          <span className="brand-sub">Roaring Ram</span>
        </div>
        <div className={`live${snap.error ? ' error' : ''}`}>
          <span className="live-dot" aria-hidden="true" />
          <span className="live-text">{snap.error ? 'Memory could not be read' : snap.busy ? `${snap.busy} is running` : 'Live, every 2 s'}</span>
        </div>
        <button
          className="btn quiet small toggle"
          aria-pressed={echoesOpen}
          aria-controls="echoes"
          onClick={() => setEchoesOpen(!echoesOpen)}
          title={echoesOpen ? 'Hide Echoes' : 'Show Echoes'}
          aria-label="Echoes"
        >
          <PanelGlyph open={echoesOpen} />
          <span className="label-wide">Echoes</span>
        </button>
        <button className="btn primary small" onClick={() => setRoaring(true)} disabled={!!snap.busy || !ready}>
          <BladeGlyph />
          The Roaring
        </button>
      </header>

      <div className={`body${echoesOpen ? '' : ' echoes-hidden'}`}>
        <main className="main" onPointerDown={() => narrow && overlayOpen && setOverlayOpen(false)}>
          {caps.notes.map((n) => (
            <p key={n} className="banner">
              {n}
            </p>
          ))}
          {snap.error && (
            <p className="banner error" role="alert">
              {snap.error} R.R. keeps trying every few seconds; the figures below are from the last good reading.
            </p>
          )}
          {ready ? <Pulse snap={snap} surgeKey={surgeKey} onWaterline={saveWaterline} /> : <p className="empty">Reading memory…</p>}
          <AppsTable snap={snap} selected={selected} onOpen={setSelected} monitorOnly={monitorOnly} />
        </main>
        <Echoes id="echoes" echoes={snap.echoes} onClear={() => void window.rr.clearEchoes()} onHide={() => setEchoesOpen(false)} />
      </div>

      <AppDrawer appKey={selected} snap={snap} caps={caps} onClose={() => setSelected(null)} onEcho={onEcho} />
      <RoaringDialog
        open={roaring}
        caps={caps}
        level={snap.sys.totalPhys ? snap.sys.used / snap.sys.totalPhys : 0}
        onClose={() => setRoaring(false)}
        onBegin={() => setSurgeKey((k) => k + 1)}
        onEcho={onEcho}
      />

      <div className={`status-region${status ? ' show' : ''}`} role="status" aria-live="polite">
        {status}
      </div>
    </div>
  )
}
