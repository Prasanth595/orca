import {
  mobileSessionRouteTarget,
  type MobileSessionRouteParams
} from '../session/mobile-session-route'

export type HostStackResetAction = Readonly<{
  type: 'RESET'
  payload: Readonly<{
    index: number
    routes: readonly Readonly<{ name: string; params: Readonly<Record<string, string>> }>[]
  }>
}>

/** Replaces the whole host stack with `[host list]` or `[host list, session]`, so a switch —
 *  even to another machine — leaves exactly one Back between the user and that host's list. */
export function hostStackResetAction(
  hostId: string,
  session?: Omit<MobileSessionRouteParams, 'hostId'>
): HostStackResetAction {
  const hostRoute = { name: '[hostId]/index', params: { hostId } }
  if (!session) {
    return { type: 'RESET', payload: { index: 0, routes: [hostRoute] } }
  }
  return {
    type: 'RESET',
    payload: { index: 1, routes: [hostRoute, mobileSessionRouteTarget({ ...session, hostId })] }
  }
}
