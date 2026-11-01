import { describe, expect, test } from 'vitest'
import { GB, MB, formatBytes, formatDelta, formatPercent, parseSize } from '../src/shared/format'

describe('formatBytes', () => {
  test('shows gigabytes with one decimal at or above 1 GB', () => {
    expect(formatBytes(15.8 * GB)).toBe('15.8 GB')
    expect(formatBytes(1 * GB)).toBe('1.0 GB')
  })

  test('shows whole megabytes below 1 GB', () => {
    expect(formatBytes(812 * MB)).toBe('812 MB')
    expect(formatBytes(1023.6 * MB)).toBe('1,024 MB')
  })

  test('shows zero honestly instead of a dash', () => {
    expect(formatBytes(0)).toBe('0 MB')
  })

  test('shows a dash when the value is unknown', () => {
    expect(formatBytes(null)).toBe('—')
  })

  test('shows sub-megabyte values as under 1 MB', () => {
    expect(formatBytes(300 * 1024)).toBe('<1 MB')
  })
})

describe('formatDelta', () => {
  test('uses a true minus sign for decreases', () => {
    expect(formatDelta(-1.24 * GB)).toBe('−1.2 GB')
  })

  test('uses a plus sign for increases', () => {
    expect(formatDelta(340 * MB)).toBe('+340 MB')
  })

  test('calls a zero change no change', () => {
    expect(formatDelta(0)).toBe('no change')
    expect(formatDelta(200 * 1024)).toBe('no change')
  })
})

describe('formatPercent', () => {
  test('rounds to whole percent', () => {
    expect(formatPercent(0.8249)).toBe('82%')
  })
})

describe('parseSize', () => {
  test('reads a number with a GB or MB unit', () => {
    expect(parseSize('10', 'GB')).toBe(10 * GB)
    expect(parseSize('1.5', 'GB')).toBe(1.5 * GB)
    expect(parseSize('512', 'MB')).toBe(512 * MB)
  })

  test('accepts a comma as decimal separator', () => {
    expect(parseSize('1,5', 'GB')).toBe(1.5 * GB)
  })

  test('reads a comma before three digits as a thousands separator', () => {
    expect(parseSize('16,384', 'MB')).toBe(16384 * MB)
    expect(parseSize('1,024.5', 'MB')).toBe(Math.round(1024.5 * MB))
  })

  test('rejects empty, negative and non-numeric input', () => {
    expect(parseSize('', 'GB')).toBeNull()
    expect(parseSize('-2', 'GB')).toBeNull()
    expect(parseSize('lots', 'MB')).toBeNull()
    expect(parseSize('0', 'MB')).toBeNull()
  })
})
