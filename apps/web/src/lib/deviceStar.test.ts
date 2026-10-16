import { describe, expect, it } from 'vitest'
import { deviceStar, type StarState } from './deviceStar.ts'
import type { ConnectionState } from './rpcClient.ts'
import type { InstallPhase } from './updateInstall.ts'

const phases = ['idle', 'installing', 'restarting', 'failed', 'lost'] as const satisfies readonly InstallPhase[]
const cases: { state: ConnectionState; lights: readonly StarState[] }[] = [
  { state: { status: 'open' }, lights: ['lit', 'lit', 'lit', 'lit', 'lit'] },
  { state: { status: 'connecting' }, lights: ['far', 'far', 'far', 'far', 'far'] },
  { state: { status: 'reconnecting' }, lights: ['far', 'far', 'far', 'far', 'far'] },
  { state: { status: 'device-offline' }, lights: ['out', 'far', 'far', 'out', 'out'] },
  { state: { status: 'rejected', reason: 'remote.rejectedKey' }, lights: ['out', 'far', 'far', 'out', 'out'] },
  { state: { status: 'closed' }, lights: ['out', 'far', 'far', 'out', 'out'] },
]

describe('the computer’s star', () => {
  for (const { state, lights } of cases) {
    it.each(phases.map((phase, i) => ({ phase, light: lights[i] })))(`${state.status} while $phase is $light`, ({ phase, light }) => {
      expect(deviceStar(state, phase)).toBe(light)
    })
  }
})
