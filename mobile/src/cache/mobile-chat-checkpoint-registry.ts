import { sha256 } from '@noble/hashes/sha256'
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils'
import type { RpcClient } from '../transport/rpc-client'
import { createChatCheckpointStore, type ChatCheckpoint } from './mobile-chat-checkpoint-store'

const scopes = new WeakMap<RpcClient, { scope: string; hostId: string }>()
const storage = async () => (await import('@react-native-async-storage/async-storage')).default
export const chatCheckpointStore = createChatCheckpointStore({
  getItem: async (key) => (await storage()).getItem(key),
  setItem: async (key, value) => (await storage()).setItem(key, value),
  removeItem: async (key) => (await storage()).removeItem(key),
  getAllKeys: async () => (await storage()).getAllKeys()
})

export function registerChatCheckpointClient(
  client: RpcClient,
  host: { id: string; publicKeyB64: string; deviceToken: string }
): void {
  const fingerprint = bytesToHex(
    sha256(utf8ToBytes(JSON.stringify([host.publicKeyB64, host.deviceToken])))
  )
  chatCheckpointStore.clearGuard(`host:${host.id}`)
  const scope = JSON.stringify([host.id, fingerprint])
  scopes.set(client, { hostId: host.id, scope })
  void chatCheckpointStore
    .removeWhere((entry) => entry.hostId === host.id && entry.scope !== scope, `pairing:${host.id}`)
    .catch(() => undefined)
}
export function checkpointAddress(client: RpcClient, namespace: string, key: string) {
  const scope = scopes.get(client)
  return scope ? { ...scope, namespace, key } : null
}

export function forgetHostChatCheckpoints(hostId: string): Promise<void> {
  return chatCheckpointStore.removeWhere((entry) => entry.hostId === hostId, `host:${hostId}`)
}

export function chatCheckpointSession(entry: Pick<ChatCheckpoint, 'namespace' | 'key'>): {
  source: string
  agent: string
  sessionId: string
} | null {
  if (entry.namespace !== 'native-chat' && entry.namespace !== 'structured-chat') {
    return null
  }
  try {
    const parts: unknown = JSON.parse(entry.key)
    if (
      Array.isArray(parts) &&
      typeof parts[0] === 'string' &&
      typeof parts[1] === 'string' &&
      typeof parts[2] === 'string'
    ) {
      return { source: parts[0], agent: parts[1], sessionId: parts[2] }
    }
  } catch {
    /* Invalid cache identities cannot match live sessions. */
  }
  return null
}

const flushListeners = new Set<() => void>()
export function subscribeChatCheckpointFlush(listener: () => void): () => void {
  flushListeners.add(listener)
  return () => {
    flushListeners.delete(listener)
  }
}
export function flushMobileChatCheckpoints(): void {
  for (const listener of flushListeners) {
    listener()
  }
}
