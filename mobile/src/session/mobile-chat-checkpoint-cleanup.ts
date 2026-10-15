import type { RpcClient } from '../transport/rpc-client'
import {
  chatCheckpointSession,
  chatCheckpointStore,
  checkpointAddress
} from '../cache/mobile-chat-checkpoint-registry'
import { encodeNativeChatTranscriptIdentity } from '../../../src/shared/native-chat-transcript-retention'
import type { MobileSessionTab } from './mobile-session-route-types'
import { resolveMobileNativeChat } from './mobile-native-chat-eligibility'

/** Only accepted host snapshots (or a successful local close) prove an owner has disappeared. */
export function reconcileMobileChatCheckpoints(
  client: RpcClient,
  hostId: string,
  worktreeId: string,
  tabs: MobileSessionTab[]
): void {
  const address = checkpointAddress(client, '', '')
  if (!address) {
    return
  }
  const source = encodeNativeChatTranscriptIdentity([hostId, worktreeId])
  const sessions = new Set<string>()
  const unknownAgents = new Set<string>()
  for (const tab of tabs) {
    const chat = resolveMobileNativeChat(tab, true)
    if (chat?.sessionId) {
      sessions.add(JSON.stringify([chat.agent, chat.sessionId]))
    } else if (chat) {
      unknownAgents.add(chat.agent)
    }
  }
  void chatCheckpointStore
    .removeWhere((entry) => {
      const session = chatCheckpointSession(entry)
      return (
        entry.scope === address.scope &&
        session?.source === source &&
        !sessions.has(JSON.stringify([session.agent, session.sessionId])) &&
        !unknownAgents.has(session.agent)
      )
    }, `workspace:${address.scope}:${worktreeId}`)
    .catch(() => undefined)
}

function checkpointWorkspace(entry: Parameters<typeof chatCheckpointSession>[0]): string | null {
  try {
    const source =
      entry.namespace === 'session-tabs' ? entry.key : chatCheckpointSession(entry)?.source
    const parts: unknown = source ? JSON.parse(source) : null
    return Array.isArray(parts) && typeof parts[1] === 'string' ? parts[1] : null
  } catch {
    return null
  }
}
export function reconcileHostChatWorkspaces(
  client: RpcClient,
  worktreeIds: readonly string[]
): void {
  const address = checkpointAddress(client, '', '')
  if (!address) {
    return
  }
  const allowed = new Set([...worktreeIds, 'global-floating-terminal'])
  void chatCheckpointStore
    .removeWhere((entry) => {
      const workspace = checkpointWorkspace(entry)
      return entry.scope === address.scope && workspace !== null && !allowed.has(workspace)
    }, `catalog:${address.scope}`)
    .catch(() => undefined)
}
export function forgetWorkspaceChatCheckpoints(client: RpcClient, worktreeId: string): void {
  const address = checkpointAddress(client, '', '')
  if (!address) {
    return
  }
  void chatCheckpointStore
    .removeWhere(
      (entry) => entry.scope === address.scope && checkpointWorkspace(entry) === worktreeId,
      `deleted-workspace:${address.scope}:${worktreeId}`
    )
    .catch(() => undefined)
}
