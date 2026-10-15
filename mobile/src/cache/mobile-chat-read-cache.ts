import type { RpcClient } from '../transport/rpc-client'
import { checkpointAddress, chatCheckpointStore } from './mobile-chat-checkpoint-registry'

const MAX_ENTRIES = 16
const MAX_BYTES = 8 * 1024 * 1024
const MAX_AGE_MS = 15 * 60 * 1000

/** Client identity prevents a re-paired host from inheriting another connection's history. */
export function createMobileChatReadCache<T>(
  namespace?: string,
  persisted?: { valid: (value: unknown) => boolean; compact: (value: T) => T }
) {
  const clients = new WeakMap<RpcClient, Map<string, { value: T; bytes: number; at: number }>>()
  const allowed = (client: RpcClient, key: string) => {
    const address = namespace ? checkpointAddress(client, namespace, key) : null
    return !address || chatCheckpointStore.allowed({ ...address, value: null, at: 0 })
  }
  return {
    allowed,
    subscribeInvalidation: chatCheckpointStore.subscribeInvalidation,
    get(client: RpcClient, key: string): T | null {
      const address = namespace ? checkpointAddress(client, namespace, key) : null
      if (address && !chatCheckpointStore.allowed({ ...address, value: null, at: 0 })) {
        return null
      }
      const entries = clients.get(client)
      const entry = entries?.get(key)
      if (!entry) {
        const address = namespace ? checkpointAddress(client, namespace, key) : null
        const value = address ? chatCheckpointStore.get(address) : null
        // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: private namespace and runtime validation protect disk restores.
        return value !== null && (!persisted || persisted.valid(value)) ? (value as T) : null
      }
      if (Date.now() - entry.at > MAX_AGE_MS) {
        entries?.delete(key)
        return null
      }
      entries?.delete(key)
      entries?.set(key, entry)
      return entry.value
    },
    async restore(client: RpcClient, key: string): Promise<T | null> {
      const address = namespace ? checkpointAddress(client, namespace, key) : null
      if (!address) {
        return this.get(client, key)
      }
      const value = await chatCheckpointStore.read(address).catch(() => null)
      // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: private namespace producer; hook checks the restored shape before display.
      return value !== null && (!persisted || persisted.valid(value)) ? (value as T) : null
    },
    // Checkpoint callers throttle streamed updates.
    set(client: RpcClient, key: string, value: T): void {
      const address = namespace ? checkpointAddress(client, namespace, key) : null
      if (address && !chatCheckpointStore.allowed({ ...address, value: null, at: 0 })) {
        return
      }
      const entries = clients.get(client) ?? new Map()
      entries.delete(key)
      const bytes = JSON.stringify(value).length * 2
      if (bytes <= MAX_BYTES) {
        entries.set(key, { value, bytes, at: Date.now() })
      }
      let total = 0
      for (const entry of entries.values()) {
        total += entry.bytes
      }
      while (entries.size > MAX_ENTRIES || total > MAX_BYTES) {
        const oldest = entries.keys().next().value
        if (oldest === undefined) {
          break
        }
        total -= entries.get(oldest)?.bytes ?? 0
        entries.delete(oldest)
      }
      clients.set(client, entries)
      if (address) {
        void chatCheckpointStore
          .write({ ...address, value: persisted?.compact(value) ?? value, at: Date.now() })
          .catch(() => undefined)
      }
    }
  }
}
