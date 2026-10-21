import { describe, expect, it } from 'vitest'
import { deviceStar, type StarState } from './deviceStar.ts'
import type { ConnectionState } from './rpcClient.ts'

const cases: { state: ConnectionState; light: StarState }[] = [
  { state: { status: 'open' }, light: 'lit' },
  { state: { status: 'connecting' }, light: 'far' },
  { state: { status: 'reconnecting' }, light: 'far' },
  // An app away to update is not reachable either: the header shows it hollow, as the Updating screen is drawn.
  { state: { status: 'device-offline' }, light: 'out' },
  { state: { status: 'rejected', reason: 'remote.rejectedKey' }, light: 'out' },
  { state: { status: 'closed' }, light: 'out' },
]

describe('the computer’s star', () => {
  it.each(cases)('$state.status is $light', ({ state, light }) => {
    expect(deviceStar(state)).toBe(light)
  })
})
