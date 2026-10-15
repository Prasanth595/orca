export type ChatCheckpoint = {
  scope: string
  hostId: string
  namespace: string
  key: string
  value: unknown
  at: number
}
export type CheckpointStorage = {
  getItem: (key: string) => Promise<string | null>
  setItem: (key: string, value: string) => Promise<void>
  removeItem: (key: string) => Promise<void>
  getAllKeys: () => Promise<readonly string[]>
}
const INDEX = 'orca:chat-checkpoints:v2:index'
const PREFIX = 'orca:chat-checkpoints:v2:'
const MAX_ENTRIES = 64
const MAX_BYTES = 16 * 1024 * 1024
const MAX_ENTRY_BYTES = 1024 * 1024
const MAX_AGE = 30 * 24 * 60 * 60 * 1000

type RecordEntry = { id: string; checkpoint: ChatCheckpoint; bytes: number }
function isCheckpoint(value: unknown): value is ChatCheckpoint {
  return (
    typeof value === 'object' &&
    value !== null &&
    'scope' in value &&
    typeof value.scope === 'string' &&
    'hostId' in value &&
    typeof value.hostId === 'string' &&
    'namespace' in value &&
    typeof value.namespace === 'string' &&
    'key' in value &&
    typeof value.key === 'string' &&
    'at' in value &&
    typeof value.at === 'number' &&
    'value' in value
  )
}

/** One serialized mutation queue keeps deletion ahead of late network/checkpoint writes. */
export function createChatCheckpointStore(storage: CheckpointStorage) {
  const entries = new Map<string, RecordEntry>()
  const invalidationListeners = new Set<() => void>()
  const denied = new Map<string, (entry: ChatCheckpoint) => boolean>()
  let queue: Promise<unknown> = Promise.resolve()
  let loaded = false
  let nextId = 0
  const identity = (entry: Pick<ChatCheckpoint, 'scope' | 'namespace' | 'key'>): string =>
    JSON.stringify([entry.scope, entry.namespace, entry.key])
  const enqueue = <T>(action: () => Promise<T>): Promise<T> => {
    const result = queue.then(action)
    queue = result.catch(() => undefined)
    return result
  }
  async function load(): Promise<void> {
    if (loaded) {
      return
    }
    const raw = await storage.getItem(INDEX)
    let ids: unknown = []
    try {
      ids = raw ? JSON.parse(raw) : []
    } catch {
      /* Rebuild a damaged manifest. */
    }
    if (Array.isArray(ids)) {
      for (const id of ids.slice(0, MAX_ENTRIES)) {
        if (typeof id !== 'string' || !/^[0-9]+-[0-9]+$/.test(id)) {
          continue
        }
        const value = await storage.getItem(PREFIX + id)
        if (!value) {
          continue
        }
        let parsed: unknown
        try {
          parsed = JSON.parse(value)
        } catch {
          await storage.removeItem(PREFIX + id)
          continue
        }
        if (
          !isCheckpoint(parsed) ||
          Date.now() - parsed.at > MAX_AGE ||
          value.length * 2 > MAX_ENTRY_BYTES
        ) {
          await storage.removeItem(PREFIX + id)
          continue
        }
        entries.set(identity(parsed), { id, checkpoint: parsed, bytes: value.length * 2 })
      }
    }
    const retainedKeys = new Set([...entries.values()].map((entry) => PREFIX + entry.id))
    for (const key of await storage.getAllKeys()) {
      if (key.startsWith(PREFIX) && key !== INDEX && !retainedKeys.has(key)) {
        await storage.removeItem(key)
      }
    }
    loaded = true
  }
  async function saveIndex(): Promise<void> {
    await storage.setItem(INDEX, JSON.stringify([...entries.values()].map((entry) => entry.id)))
  }
  async function trim(): Promise<void> {
    let total = [...entries.values()].reduce((sum, entry) => sum + entry.bytes, 0)
    for (const [key, entry] of entries) {
      if (
        Date.now() - entry.checkpoint.at > MAX_AGE ||
        entries.size > MAX_ENTRIES ||
        total > MAX_BYTES
      ) {
        entries.delete(key)
        total -= entry.bytes
        await storage.removeItem(PREFIX + entry.id)
      }
    }
  }
  return {
    get(entry: Pick<ChatCheckpoint, 'scope' | 'namespace' | 'key'>): unknown {
      const record = entries.get(identity(entry))
      return record &&
        Date.now() - record.checkpoint.at <= MAX_AGE &&
        ![...denied.values()].some((test) => test(record.checkpoint))
        ? record.checkpoint.value
        : null
    },
    read(entry: Pick<ChatCheckpoint, 'scope' | 'namespace' | 'key'>): Promise<unknown> {
      return enqueue(async () => {
        await load()
        await trim()
        await saveIndex()
        return this.get(entry)
      })
    },
    write(checkpoint: ChatCheckpoint): Promise<void> {
      return enqueue(async () => {
        await load()
        if ([...denied.values()].some((test) => test(checkpoint))) {
          return
        }
        const value = JSON.stringify(checkpoint)
        if (value.length * 2 > MAX_ENTRY_BYTES) {
          return
        }
        const key = identity(checkpoint)
        const previous = entries.get(key)
        let id = previous?.id ?? `${Date.now()}-${nextId++}`
        while (!previous && [...entries.values()].some((entry) => entry.id === id)) {
          id = `${Date.now()}-${nextId++}`
        }
        // Index first: interrupted writes leave an absent payload, never unindexed orphan files.
        entries.delete(key)
        entries.set(key, { id, checkpoint, bytes: value.length * 2 })
        await trim()
        await saveIndex()
        if (entries.has(key)) {
          await storage.setItem(PREFIX + id, value)
        }
      })
    },
    removeWhere(test: (entry: ChatCheckpoint) => boolean, guardId = 'deletion'): Promise<void> {
      denied.delete(guardId)
      denied.set(guardId, test)
      while (denied.size > 128) {
        const oldest = denied.keys().next().value
        if (oldest !== undefined) {
          denied.delete(oldest)
        }
      }
      for (const listener of invalidationListeners) {
        listener()
      }
      return enqueue(async () => {
        await load()
        const removed: string[] = []
        for (const [key, entry] of entries) {
          if (test(entry.checkpoint)) {
            removed.push(PREFIX + entry.id)
            entries.delete(key)
          }
        }
        await saveIndex()
        for (const key of removed) {
          await storage.removeItem(key)
        }
      })
    },
    subscribeInvalidation: (listener: () => void) => {
      invalidationListeners.add(listener)
      return () => {
        invalidationListeners.delete(listener)
      }
    },
    allowed: (entry: ChatCheckpoint) => ![...denied.values()].some((test) => test(entry)),
    clearGuard: (id: string) => {
      denied.delete(id)
    },
    settled: () => queue
  }
}
