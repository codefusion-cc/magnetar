/** How far Page Up and Page Down move through a list. */
export const PAGE_STEP = 10

/**
 * The option a key moves to in an open list of `length`, from `current`: arrows by one, Page keys by ten, Home and
 * End to the ends, all stopping at the ends rather than wrapping (as a native select does). Null for any other key.
 */
export function moveActive(key: string, current: number, length: number): number | null {
  if (length === 0) return null
  const last = length - 1
  const clamp = (index: number) => Math.min(last, Math.max(0, index))
  switch (key) {
    case 'ArrowDown': return clamp(current + 1)
    case 'ArrowUp': return clamp(current - 1)
    case 'PageDown': return clamp(current + PAGE_STEP)
    case 'PageUp': return clamp(current - PAGE_STEP)
    case 'Home': return 0
    case 'End': return last
    default: return null
  }
}

/**
 * A single printable character, as typing to find an option takes it; null for keys that do something else. Space is
 * one only `typing` (in the middle of a word, "name a"); otherwise it chooses.
 */
export function typedCharacter(event: { key: string; ctrlKey: boolean; metaKey: boolean; altKey: boolean }, typing = false): string | null {
  if (event.ctrlKey || event.metaKey || event.altKey) return null
  if (event.key === ' ') return typing ? ' ' : null
  return [...event.key].length === 1 ? event.key : null
}

/**
 * The option typing finds: the next one, after `current`, whose label starts with what was typed in the last moment,
 * compared without case or accents in `language`. The same letter typed again steps through the options it starts.
 * Null when none matches, so the list stays where it was.
 */
export function findTyped(labels: readonly string[], typed: string, current: number, language?: string): number | null {
  if (!typed || labels.length === 0) return null
  const fold = (text: string) => text.normalize('NFD').replace(/\p{M}/gu, '').toLocaleLowerCase(language)
  const wanted = fold(typed)
  // "aaa" is the same letter pressed three times: step through the options starting with "a".
  const repeated = [...wanted].every(c => c === wanted[0]) ? wanted[0]! : null
  const start = repeated !== null || typed.length === 1 ? current + 1 : current
  for (let step = 0; step < labels.length; step++) {
    const index = (start + step + labels.length) % labels.length
    const label = fold(labels[index]!)
    if (label.startsWith(wanted) || (repeated !== null && label.startsWith(repeated))) return index
  }
  return null
}
