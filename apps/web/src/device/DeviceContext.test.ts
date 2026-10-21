import { describe, expect, test } from 'vitest'
import { readFailed, readStarted, type ReadState } from './DeviceContext.tsx'

const never: ReadState = { loading: true, failed: false }
const read: ReadState = { loading: false, failed: false }
const failed: ReadState = { loading: false, failed: true }

describe('a list read', () => {
  test('the first read waits, and says so when it fails', () => {
    expect(readStarted(never)).toEqual(never)
    expect(readFailed(readStarted(never))).toEqual(failed)
  })

  test('Try again after a failed first read waits again', () => {
    expect(readStarted(failed)).toEqual(never)
  })

  test('a list already read stays on screen while a reconnect reads it again', () => {
    expect(readStarted(read)).toEqual(read)
  })

  test('a list already read stays on screen when reading it again fails', () => {
    expect(readFailed(readStarted(read))).toEqual(read)
  })

  test('two reconnects in a row, the second failing, keep it', () => {
    expect(readFailed(readStarted(readStarted(read)))).toEqual(read)
  })
})
