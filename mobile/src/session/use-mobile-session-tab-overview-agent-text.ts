import { useEffect, useState } from 'react'
import { getCachedWorktrees } from '../cache/worktree-cache'
import type { RpcClient } from '../transport/rpc-client'
import type { ConnectionState } from '../transport/types'
import { worktreeCatalogRead } from '../worktree/worktree-catalog-operations'
import { WORKTREE_PS_FULL_LIMIT } from '../worktree/worktree-catalog-snapshot-client'
import {
  NO_AGENT_TEXT,
  readWorktreeAgentText,
  type MobileSessionTabOverviewAgentText
} from './mobile-session-tab-overview-agent-text'

type AgentTextSnapshot = {
  routeKey: string
  text: ReadonlyMap<string, MobileSessionTabOverviewAgentText>
}

/**
 * The worktree list's agent words for this session's panes, read when the tab list opens and again
 * whenever a tab's agent changes state while it is open, so a turn that just ended shows its last
 * words. Kept between opens: the list reopens on what it last read while the next read runs.
 */
export function useMobileSessionTabOverviewAgentText({
  client,
  connState,
  hostId,
  worktreeId,
  open,
  agentStateKey
}: {
  client: RpcClient | null
  connState: ConnectionState
  hostId: string
  worktreeId: string
  open: boolean
  /** Changes whenever any tab's agent state or state clock does. */
  agentStateKey: string
}): ReadonlyMap<string, MobileSessionTabOverviewAgentText> {
  const routeKey = JSON.stringify([hostId, worktreeId])
  const [snapshot, setSnapshot] = useState<AgentTextSnapshot | null>(null)

  useEffect(() => {
    if (!open || !client || connState !== 'connected' || !hostId) {
      return
    }
    let stale = false
    // The host screen's list from the last 30s answers at once on the first open.
    const cached = getCachedWorktrees(hostId)
    if (cached) {
      setSnapshot((current) =>
        current?.routeKey === routeKey
          ? current
          : { routeKey, text: readWorktreeAgentText(cached, worktreeId) }
      )
    }
    worktreeCatalogRead
      .requestSingleFlight(client, hostId, { limit: WORKTREE_PS_FULL_LIMIT })
      .then((reply) => {
        const catalog = worktreeCatalogRead.interpret(reply)
        if (stale || !catalog.accepted) {
          return
        }
        setSnapshot({
          routeKey,
          text: readWorktreeAgentText(catalog.value.worktrees ?? [], worktreeId)
        })
      })
      .catch(() => {
        // Keeps the words already shown; the next open or state change asks again.
      })
    return () => {
      stale = true
    }
  }, [open, client, connState, hostId, worktreeId, routeKey, agentStateKey])

  return snapshot?.routeKey === routeKey ? snapshot.text : NO_AGENT_TEXT
}
