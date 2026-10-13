import type { AgentHookEventPayload } from '../shared/agent-hook-listener/listener-event'
import type { AgentHookSource } from '../shared/agent-hook-relay'
import { isSameAgentProcess } from '../shared/agent-process-presence'
import { isClaudePermissionResult } from '../shared/agent-hook-listener/providers/claude-permission-poll'
import { buildRelayHookEnvelope } from './agent-hook-envelope-build'
import type { RelayHookForward } from './agent-hook-server-contract'
import { MAX_RETAINED_CLAUDE_PERMISSION_RESULTS } from '../shared/agent-hook-listener/claude-permission-replay'

export type CachedPaneEnvelopeMeta = {
  source: AgentHookSource
  env?: string
  version?: string
  claudePermissionResults?: readonly AgentHookEventPayload[]
}

/** A newer display row must not erase the request evidence a disconnected receiver still needs. */
export function retainClaudePermissionResults(
  previous: CachedPaneEnvelopeMeta | undefined,
  event: AgentHookEventPayload
): readonly AgentHookEventPayload[] | undefined {
  const owner = event.agentPresence?.process
  if (event.source !== 'claude' || event.agentPresence?.ended || !owner) {
    return undefined
  }
  const retained = (previous?.claudePermissionResults ?? []).filter(
    (result) =>
      result.paneKey === event.paneKey &&
      result.worktreeId === event.worktreeId &&
      result.tabId === event.tabId &&
      result.connectionId === event.connectionId &&
      result.launchToken === event.launchToken &&
      result.hostTurnRevision === event.hostTurnRevision &&
      result.providerSession?.key === event.providerSession?.key &&
      result.providerSession?.id === event.providerSession?.id &&
      result.providerSession?.transcriptPath === event.providerSession?.transcriptPath &&
      result.agentPresence?.process !== undefined &&
      isSameAgentProcess(result.agentPresence.process, owner)
  )
  if (isClaudePermissionResult(event)) {
    const existing = retained.findIndex(
      (result) =>
        result.toolUseId === event.toolUseId &&
        result.toolAgentId === event.toolAgentId &&
        result.toolAgentType === event.toolAgentType
    )
    if (existing !== -1) {
      retained.splice(existing, 1)
    }
    retained.push(event)
  }
  return retained.length ? retained.slice(-MAX_RETAINED_CLAUDE_PERMISSION_RESULTS) : undefined
}

export type CachedPaneReplaySelection = {
  event: AgentHookEventPayload
  meta: CachedPaneEnvelopeMeta
}

export function replayCachedPaneStatus(
  { event, meta }: CachedPaneReplaySelection,
  forward: RelayHookForward
): void {
  const envelope = buildRelayHookEnvelope(event, meta.source, meta.env, meta.version, {
    isReplay: true
  })
  const results = event.payload.state !== 'waiting' ? meta.claudePermissionResults : undefined
  // Older peers see only the current status; exact request facts are additive metadata.
  forward(
    results?.length
      ? {
          ...envelope,
          claudePermissionResults: results.map(({ toolUseId, toolAgentId, toolAgentType }) => ({
            toolUseId: toolUseId!,
            toolAgentId,
            toolAgentType
          }))
        }
      : envelope
  )
}

/**
 * Chooses which cached pane statuses a reconnecting client may be re-told about, and drops the rest.
 *
 * Two panes are refused, for opposite reasons:
 * - a pane whose surface has been retired — the tab is gone, so replaying its status would hand the
 *   client a live agent pane nobody owns, which is what drives an auto-resume onto a transcript an
 *   orphaned agent is still writing;
 * - a pane whose envelope metadata is missing — the status cache and the metadata map are populated
 *   and cleared in lockstep, so a key present in one and not the other is drift. Skip rather than
 *   guess a source that mis-tags the replay downstream.
 */
export function selectReplayableCachedPanes(input: {
  cachedByPaneKey: ReadonlyMap<string, AgentHookEventPayload>
  metaByPaneKey: ReadonlyMap<string, CachedPaneEnvelopeMeta>
  isPaneSurfaceRetired: (paneKey: string) => boolean
  dropPane: (paneKey: string) => void
}): CachedPaneReplaySelection[] {
  const selected: CachedPaneReplaySelection[] = []
  // Snapshot: dropping a retired pane mutates the map being read.
  for (const [paneKey, event] of Array.from(input.cachedByPaneKey.entries())) {
    if (input.isPaneSurfaceRetired(paneKey)) {
      input.dropPane(paneKey)
      continue
    }
    const meta = input.metaByPaneKey.get(paneKey)
    if (meta) {
      selected.push({ event, meta })
    }
  }
  return selected
}

/** How many panes keep a cached status. Bounds a long-lived relay's per-pane state. */
export const MAX_CACHED_PANES = 256
