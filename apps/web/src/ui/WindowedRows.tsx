import type { Key, ReactNode } from 'react'
import { useWindowedList } from '@codefusion-cc/ui/react'

/**
 * `WindowedList` from `@codefusion-cc/ui/react` with a name for the list, which the package's component does not take
 * yet. Only the rows on screen, plus a few and the focused one, are in the page; `--row-height` on `className` sets
 * each breakpoint's fixed row height, and a row's contents must fit it.
 */
export function WindowedRows({ label, busy, count, getKey, className, rowClassName, renderRow }: {
  label: string
  busy?: boolean
  count: number
  /** Stable and unique per row; memoize it, every key is rebuilt when it changes. */
  getKey: (index: number) => Key
  className: string
  rowClassName?: string
  renderRow: (index: number) => ReactNode
}) {
  const { listProps, rows } = useWindowedList({ count, getKey })
  return <ul {...listProps} aria-label={label} aria-busy={busy} className={className}>
    {rows.map(row => <li key={row.key} className={rowClassName} style={row.style} aria-setsize={count} aria-posinset={row.index + 1}>{renderRow(row.index)}</li>)}
  </ul>
}
