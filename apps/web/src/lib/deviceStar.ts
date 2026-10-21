import type { ConnectionState } from './rpcClient.ts'

export type StarState = 'lit' | 'far' | 'out'

/** Lit while the computer answers, far while the page is (re)connecting, out when it can't be reached, an update's restart included. */
export function deviceStar(state: ConnectionState): StarState {
  if (state.status === 'open') return 'lit'
  if (state.status === 'connecting' || state.status === 'reconnecting') return 'far'
  return 'out'
}
