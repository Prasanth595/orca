import { promises as fs } from 'node:fs'
import { dirname } from 'node:path'
import type { ItemSnapshot } from './transitions'

/**
 * Dedup + watermark bookkeeping for the review poller.
 *
 * A fingerprint covers (provider|host|repo|kind|iid|action|updatedAt), so the
 * same provider event never notifies twice — across restarts — while a new
 * action on the same MR (e.g. ready_for_review after opened) is distinct.
 * The store is bounded: fingerprints are an LRU capped at MAX_FINGERPRINTS.
 *
 * Per-item snapshots are persisted too: transition classification needs the
 * *previous* snapshot, and an in-memory-only snapshot would make every
 * changed item look "opened" again after a restart.
 */

export const MAX_FINGERPRINTS = 2000

export type ReviewWatermarkStore = {
  /** ISO timestamp of the last poll that advanced this key, or null. */
  getWatermark: (key: string) => string | null
  setWatermark: (key: string, iso: string) => void
  hasFingerprint: (fingerprint: string) => boolean
  addFingerprint: (fingerprint: string) => void
  /** Last-seen per-item snapshot for transition classification. */
  getSnapshot: (key: string) => ItemSnapshot | undefined
  setSnapshot: (key: string, snapshot: ItemSnapshot) => void
  deleteSnapshot: (key: string) => void
  /** Persist (no-op for the in-memory store). */
  flush: () => Promise<void>
}

export function watermarkKey(
  provider: string,
  host: string,
  repo: string,
  kind: 'mr' | 'issue'
): string {
  return [provider, host.toLowerCase(), repo.toLowerCase(), kind].join('|')
}

/**
 * Advance a watermark to `candidateIso` only when it moves forward; a
 * provider clock skewing backwards must not rewind the poll window and
 * re-notify. Returns the effective watermark after the call.
 */
export function advanceWatermark(
  store: ReviewWatermarkStore,
  key: string,
  candidateIso: string
): string {
  const current = store.getWatermark(key)
  if (!current || candidateIso > current) {
    store.setWatermark(key, candidateIso)
    return candidateIso
  }
  return current
}

export function createInMemoryWatermarkStore(): ReviewWatermarkStore {
  const watermarks = new Map<string, string>()
  const fingerprints: string[] = []
  const fingerprintSet = new Set<string>()
  const snapshots = new Map<string, ItemSnapshot>()
  return {
    getWatermark: (key) => watermarks.get(key) ?? null,
    setWatermark: (key, iso) => {
      watermarks.set(key, iso)
    },
    hasFingerprint: (fp) => fingerprintSet.has(fp),
    addFingerprint: (fp) => {
      if (fingerprintSet.has(fp)) {
        return
      }
      fingerprints.push(fp)
      fingerprintSet.add(fp)
      while (fingerprints.length > MAX_FINGERPRINTS) {
        const evicted = fingerprints.shift()
        if (evicted) {
          fingerprintSet.delete(evicted)
        }
      }
    },
    getSnapshot: (key) => snapshots.get(key),
    setSnapshot: (key, snapshot) => {
      snapshots.set(key, snapshot)
    },
    deleteSnapshot: (key) => {
      snapshots.delete(key)
    },
    flush: async () => {}
  }
}

type PersistedState = {
  watermarks: Record<string, string>
  fingerprints: string[]
  snapshots: Record<string, ItemSnapshot>
}

async function readState(filePath: string): Promise<PersistedState> {
  try {
    const raw = await fs.readFile(filePath, 'utf-8')
    // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: JSON.parse returns any; fields are defaulted below so a corrupt file degrades to empty state.
    const parsed = JSON.parse(raw) as Partial<PersistedState>
    return {
      watermarks: parsed.watermarks ?? {},
      fingerprints: Array.isArray(parsed.fingerprints) ? parsed.fingerprints : [],
      snapshots:
        parsed.snapshots !== null && typeof parsed.snapshots === 'object' ? parsed.snapshots : {}
    }
  } catch {
    return { watermarks: {}, fingerprints: [], snapshots: {} }
  }
}

/** File-backed store; safe to construct even when the file does not exist yet. */
export function createFileWatermarkStore(filePath: string): ReviewWatermarkStore {
  let loaded: Promise<PersistedState> | null = null
  let state: PersistedState = { watermarks: {}, fingerprints: [], snapshots: {} }
  let dirty = false
  // Serializes flushes: concurrent polls share one store, and overlapping
  // writeFile calls on the same path are not safe. A failed write marks the
  // store dirty again so the next flush retries; the chain itself never breaks.
  let writeChain: Promise<void> = Promise.resolve()
  const ensureLoaded = async (): Promise<PersistedState> => {
    if (!loaded) {
      loaded = readState(filePath).then((s) => {
        // Writes issued before the load completed win over the file content.
        for (const [k, v] of Object.entries(state.watermarks)) {
          s.watermarks[k] = v
        }
        const seen = new Set(s.fingerprints)
        for (const fp of state.fingerprints) {
          if (!seen.has(fp)) {
            s.fingerprints.push(fp)
            seen.add(fp)
          }
        }
        for (const [k, v] of Object.entries(state.snapshots)) {
          s.snapshots[k] = v
        }
        state = s
        return s
      })
    }
    return loaded
  }
  void ensureLoaded()
  const fingerprintSet = new Set<string>()
  void ensureLoaded().then((s) => {
    for (const fp of s.fingerprints) {
      fingerprintSet.add(fp)
    }
  })
  return {
    getWatermark: (key) => state.watermarks[key] ?? null,
    setWatermark: (key, iso) => {
      state.watermarks[key] = iso
      dirty = true
    },
    hasFingerprint: (fp) => fingerprintSet.has(fp),
    addFingerprint: (fp) => {
      if (fingerprintSet.has(fp)) {
        return
      }
      state.fingerprints.push(fp)
      fingerprintSet.add(fp)
      while (state.fingerprints.length > MAX_FINGERPRINTS) {
        const evicted = state.fingerprints.shift()
        if (evicted) {
          fingerprintSet.delete(evicted)
        }
      }
      dirty = true
    },
    getSnapshot: (key) => state.snapshots[key],
    setSnapshot: (key, snapshot) => {
      state.snapshots[key] = snapshot
      dirty = true
    },
    deleteSnapshot: (key) => {
      delete state.snapshots[key]
      dirty = true
    },
    flush: () => {
      const run = writeChain.then(async () => {
        await ensureLoaded()
        if (!dirty) {
          return
        }
        // Take the dirty flag before writing: mutations during the write set
        // it again and are picked up by the next flush instead of being lost.
        dirty = false
        const payload = JSON.stringify(state)
        try {
          await fs.mkdir(dirname(filePath), { recursive: true })
          // Atomic write: a crash mid-write leaves the previous file intact.
          const tmp = `${filePath}.${process.pid}.tmp`
          await fs.writeFile(tmp, payload, 'utf-8')
          await fs.rename(tmp, filePath)
        } catch (error) {
          dirty = true
          throw error
        }
      })
      writeChain = run.catch(() => {})
      return run
    }
  }
}
