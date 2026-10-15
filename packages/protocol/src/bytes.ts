const UNITS = ['B', 'KiB', 'MiB', 'GiB', 'TiB', 'PiB']
const DECIMAL_UNITS = ['B', 'KB', 'MB', 'GB', 'TB', 'PB']

export interface ByteFormatOptions {
  decimal?: boolean
  locale?: string
}

/** Binary sizes by default; decimal units and a locale can be chosen for presentation. */
export function formatBytes(bytes: number, decimals = 1, options: ByteFormatOptions = {}): string {
  const units = options.decimal ? DECIMAL_UNITS : UNITS
  const base = options.decimal ? 1000 : 1024
  let size = Math.max(0, bytes)
  let unit = 0
  while (size >= base && unit < units.length - 1) {
    size /= base
    unit++
  }
  const factor = 10 ** decimals
  const rounded = Math.round(size * factor) / factor
  const value = options.locale ? new Intl.NumberFormat(options.locale, { maximumFractionDigits: decimals }).format(rounded) : rounded
  return `${value} ${units[unit]}`
}

/** Formats a per-second rate, e.g. "2.3 MiB/s". */
export function formatRate(bytesPerSecond: number): string {
  return `${formatBytes(bytesPerSecond)}/s`
}
