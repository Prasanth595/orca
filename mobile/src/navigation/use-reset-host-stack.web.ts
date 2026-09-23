import { useCallback } from 'react'
import type { ResetHostStack } from './use-reset-host-stack'
import { useRouteHandoff } from './route-handoff'

/** Web: the page owns no stack to reset, so the target is handed to the shell as a replace. */
export function useResetHostStack(): ResetHostStack {
  const router = useRouteHandoff()
  return useCallback(
    (hostId, session) => {
      const host = `/h/${encodeURIComponent(hostId)}`
      if (!session) {
        router.replace(host)
        return
      }
      const query = session.name ? `?name=${encodeURIComponent(session.name)}` : ''
      router.replace(`${host}/session/${encodeURIComponent(session.worktreeId)}${query}`)
    },
    [router]
  )
}
