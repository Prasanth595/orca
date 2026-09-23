import { useCallback } from 'react'
import { useNavigation } from 'expo-router'
import type { MobileSessionRouteParams } from '../session/mobile-session-route'
import { hostStackResetAction, type HostStackResetAction } from './host-stack-reset'

export type ResetHostStack = (
  hostId: string,
  session?: Omit<MobileSessionRouteParams, 'hostId'>
) => void

/** Swaps the host stack in one dispatch, so switching machines never stacks a second host. */
export function useResetHostStack(): ResetHostStack {
  const navigation = useNavigation<{ dispatch: (action: HostStackResetAction) => void }>()
  return useCallback(
    (hostId, session) => navigation.dispatch(hostStackResetAction(hostId, session)),
    [navigation]
  )
}
