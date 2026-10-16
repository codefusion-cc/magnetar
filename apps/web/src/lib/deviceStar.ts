import type { ConnectionState } from './rpcClient.ts'
import { expectsAway, type InstallPhase } from './updateInstall.ts'

export type StarState = 'lit' | 'far' | 'out'

/** An expected update restart stays a distant light, even after the transport closes. */
export function deviceStar(state: ConnectionState, phase: InstallPhase): StarState {
  if (state.status === 'open') return 'lit'
  if (expectsAway(phase) || state.status === 'connecting' || state.status === 'reconnecting') return 'far'
  return 'out'
}
