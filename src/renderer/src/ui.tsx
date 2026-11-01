import { useEffect, useRef, useState, type ButtonHTMLAttributes, type ReactNode } from 'react'

export function useMediaQuery(query: string): boolean {
  const [match, setMatch] = useState(() => window.matchMedia(query).matches)
  useEffect(() => {
    const m = window.matchMedia(query)
    const on = () => setMatch(m.matches)
    on()
    m.addEventListener('change', on)
    return () => m.removeEventListener('change', on)
  }, [query])
  return match
}

export function useReducedMotion(): boolean {
  return useMediaQuery('(prefers-reduced-motion: reduce)')
}

/**
 * A native <dialog>: focus is trapped and Escape works for free. Closing plays the exit
 * transition first, then really closes, and focus returns to whatever opened it.
 */
export function Dialog(props: {
  open: boolean
  onClose: () => void
  variant: 'modal' | 'drawer'
  labelledBy: string
  children: ReactNode
  /** While true, Escape and the backdrop do nothing (an action is running). */
  locked?: boolean
}) {
  const ref = useRef<HTMLDialogElement>(null)
  const [closing, setClosing] = useState(false)
  const reduce = useReducedMotion()

  useEffect(() => {
    const d = ref.current
    if (!d) return
    if (props.open && !d.open) {
      setClosing(false)
      d.showModal()
    } else if (!props.open && d.open) {
      setClosing(true)
      const done = () => {
        d.close()
        setClosing(false)
      }
      const t = window.setTimeout(done, reduce ? 160 : props.variant === 'drawer' ? 200 : 150)
      return () => window.clearTimeout(t)
    }
    return undefined
  }, [props.open, props.variant, reduce])

  return (
    <dialog
      ref={ref}
      className={`${props.variant}${closing ? ' closing' : ''}`}
      aria-labelledby={props.labelledBy}
      onCancel={(e) => {
        e.preventDefault()
        if (!props.locked) props.onClose()
      }}
      onMouseDown={(e) => {
        // A press on the backdrop lands on the dialog element itself.
        if (e.target === ref.current && !props.locked) props.onClose()
      }}
    >
      {props.open || closing ? <div className="dialog-body">{props.children}</div> : null}
    </dialog>
  )
}

/**
 * A confirm button that marks a deliberate action: when pressed, one thin edge of light crosses it.
 * The sweep is feedback only and finishes before anything is measured.
 */
export function BladeButton({ children, onClick, className = 'btn primary', ...rest }: ButtonHTMLAttributes<HTMLButtonElement>) {
  const blade = useRef<HTMLSpanElement>(null)
  const reduce = useReducedMotion()
  return (
    <button
      {...rest}
      className={className}
      onClick={(e) => {
        const el = blade.current
        if (el) {
          el.animate(
            reduce
              ? [{ opacity: 0 }, { opacity: 0.6 }, { opacity: 0 }]
              : [
                  { transform: 'translateX(-110%)', opacity: 1 },
                  { transform: 'translateX(420%)', opacity: 1 }
                ],
            { duration: reduce ? 200 : 280, easing: 'cubic-bezier(0.23, 1, 0.32, 1)' }
          )
        }
        onClick?.(e)
      }}
    >
      <span className="blade" ref={blade} aria-hidden="true" />
      {children}
    </button>
  )
}

const GLYPHS = '╱╲░▒▚▞∴∵⌁⌇⟊⟟'

/**
 * Scrambled glyphs that resolve into a word, once, when an entry first appears. Purely
 * decorative: the real text is always present for assistive technology, and real values
 * (sizes, counts, names) are never passed through this.
 */
export function Scramble({ text, active }: { text: string; active: boolean }) {
  const reduce = useReducedMotion()
  const [shown, setShown] = useState(active && !reduce ? scramble(text, 0) : text)
  useEffect(() => {
    if (!active || reduce) {
      setShown(text)
      return
    }
    let frame = 0
    const id = window.setInterval(() => {
      frame++
      const progress = frame / 10
      setShown(scramble(text, progress))
      if (progress >= 1) window.clearInterval(id)
    }, 40)
    return () => window.clearInterval(id)
  }, [text, active, reduce])
  return (
    <>
      <span className="sr-only">{text}</span>
      <span className="scramble" aria-hidden="true">
        {shown}
      </span>
    </>
  )
}

function scramble(text: string, progress: number): string {
  const keep = Math.floor(text.length * progress)
  let out = ''
  for (let i = 0; i < text.length; i++) {
    out += i < keep || text[i] === ' ' ? text[i] : GLYPHS[(i * 7 + Math.floor(progress * 31)) % GLYPHS.length]
  }
  return out
}

/** R.R.'s mark: a vessel with its waterline. Drawn for the product, not borrowed from anything. */
export function Mark({ size = 22 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
      <rect x="6.5" y="1.5" width="11" height="21" rx="5.5" fill="none" stroke="currentColor" strokeWidth="1.4" />
      <rect x="8" y="11" width="8" height="10" rx="1.2" fill="#7fe6f5" opacity="0.28" />
      <line x1="7.6" y1="11" x2="16.4" y2="11" stroke="#dcfaff" strokeWidth="1.4" />
    </svg>
  )
}

/** A narrow blade: the sign for a deliberate, confirmed action. */
export function BladeGlyph() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
      <path d="M7 0.8 L8.1 9.2 L7 10.4 L5.9 9.2 Z" fill="currentColor" />
      <rect x="3.6" y="9.9" width="6.8" height="1.1" rx="0.5" fill="currentColor" />
      <rect x="6.45" y="11" width="1.1" height="2.4" rx="0.5" fill="currentColor" />
    </svg>
  )
}

export function CloseGlyph() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
      <path d="M3 3 L11 11 M11 3 L3 11" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  )
}

export function PanelGlyph({ open }: { open: boolean }) {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
      <rect x="1.5" y="2.5" width="13" height="11" rx="2.5" fill="none" stroke="currentColor" strokeWidth="1.2" />
      <rect x="10" y="3" width="4" height="10" fill="currentColor" opacity={open ? 0.8 : 0.15} />
    </svg>
  )
}
