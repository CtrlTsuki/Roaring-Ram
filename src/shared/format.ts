// Units follow Windows: 1 GB = 1,024 MB = 1,073,741,824 bytes.
export const MB = 1024 * 1024
export const GB = 1024 * MB

const grouped = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 })

export function formatBytes(bytes: number | null | undefined): string {
  if (bytes == null || Number.isNaN(bytes)) return '—'
  const abs = Math.abs(bytes)
  if (abs === 0) return '0 MB'
  if (abs >= GB) return `${(bytes / GB).toFixed(1)} GB`
  if (abs < MB) return '<1 MB'
  return `${grouped.format(Math.round(bytes / MB))} MB`
}

/** A signed change. Anything under 1 MB either way reads as no change. */
export function formatDelta(bytes: number): string {
  if (Math.abs(bytes) < MB) return 'no change'
  const sign = bytes < 0 ? '−' : '+'
  return `${sign}${formatBytes(Math.abs(bytes))}`
}

export function formatPercent(fraction: number): string {
  return `${Math.round(fraction * 100)}%`
}

export type SizeUnit = 'GB' | 'MB'

/** Reads a positive size typed by a person. Returns bytes, or null when it is not a usable size. */
export function parseSize(text: string, unit: SizeUnit): number | null {
  const trimmed = text.trim()
  // "16,384" is sixteen thousand; "1,5" is one and a half.
  const cleaned = /^\d{1,3}(,\d{3})+(\.\d+)?$/.test(trimmed) ? trimmed.replace(/,/g, '') : trimmed.replace(',', '.')
  if (!/^\d+(\.\d+)?$/.test(cleaned)) return null
  const value = Number(cleaned)
  if (!(value > 0)) return null
  return Math.round(value * (unit === 'GB' ? GB : MB))
}

export function formatDuration(ms: number): string {
  const s = Math.round(ms / 1000)
  if (s < 60) return `${s} s`
  const m = Math.floor(s / 60)
  const rest = s % 60
  return rest ? `${m} min ${rest} s` : `${m} min`
}
