const numbers = new Map<string, Intl.NumberFormat>()

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
  let size = Number.isFinite(bytes) ? Math.max(0, bytes) : 0
  let unit = 0
  while (size >= base && unit < units.length - 1) {
    size /= base
    unit++
  }
  const factor = 10 ** decimals
  let rounded = Math.round(size * factor) / factor
  // 999.96 KB rounds to 1000 KB: say 1 MB instead.
  if (rounded >= base && unit < units.length - 1) {
    unit++
    rounded = Math.round((size / base) * factor) / factor
  }
  let value: string | number = rounded
  if (options.locale) {
    const key = `${options.locale}:${decimals}`
    let format = numbers.get(key)
    if (!format) { format = new Intl.NumberFormat(options.locale, { maximumFractionDigits: decimals }); numbers.set(key, format) }
    value = format.format(rounded)
  }
  return `${value} ${units[unit]}`
}

/** Formats a per-second rate, e.g. "2.3 MiB/s". */
export function formatRate(bytesPerSecond: number, decimals = 1, options: ByteFormatOptions = {}): string {
  return `${formatBytes(bytesPerSecond, decimals, options)}/s`
}
