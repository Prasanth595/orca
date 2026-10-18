import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  advanceWatermark,
  createFileWatermarkStore,
  createInMemoryWatermarkStore,
  MAX_FINGERPRINTS,
  watermarkKey
} from './dedup'

describe('dedup', () => {
  it('watermarkKey is stable and case-insensitive', () => {
    expect(watermarkKey('gitlab', 'H', 'R', 'mr')).toBe(watermarkKey('gitlab', 'h', 'r', 'mr'))
    expect(watermarkKey('gitlab', 'h', 'r', 'mr')).not.toBe(
      watermarkKey('gitlab', 'h', 'r', 'issue')
    )
  })

  it('advanceWatermark moves forward only (clock skew never rewinds)', () => {
    const store = createInMemoryWatermarkStore()
    const key = watermarkKey('gitlab', 'h', 'r', 'mr')
    expect(store.getWatermark(key)).toBeNull()
    expect(advanceWatermark(store, key, '2026-10-19T10:00:00Z')).toBe('2026-10-19T10:00:00Z')
    // Older candidate: ignored.
    expect(advanceWatermark(store, key, '2026-10-19T09:00:00Z')).toBe('2026-10-19T10:00:00Z')
    expect(store.getWatermark(key)).toBe('2026-10-19T10:00:00Z')
    // Newer candidate: advances.
    expect(advanceWatermark(store, key, '2026-10-19T11:00:00Z')).toBe('2026-10-19T11:00:00Z')
  })

  it('bounds fingerprints as an LRU', () => {
    const store = createInMemoryWatermarkStore()
    for (let i = 0; i < MAX_FINGERPRINTS + 10; i++) {
      store.addFingerprint(`fp-${i}`)
    }
    expect(store.hasFingerprint('fp-0')).toBe(false)
    expect(store.hasFingerprint(`fp-${MAX_FINGERPRINTS + 9}`)).toBe(true)
    // Re-adding is a no-op, not a duplicate.
    store.addFingerprint(`fp-${MAX_FINGERPRINTS + 9}`)
    expect(store.hasFingerprint(`fp-${MAX_FINGERPRINTS + 9}`)).toBe(true)
  })

  it('file store persists watermarks and fingerprints across instances', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'review-notifications-'))
    const file = join(dir, 'state.json')
    const first = createFileWatermarkStore(file)
    const key = watermarkKey('gitlab', 'h', 'r', 'mr')
    first.setWatermark(key, '2026-10-19T10:00:00Z')
    first.addFingerprint('abc123')
    await first.flush()

    const second = createFileWatermarkStore(file)
    await second.flush() // no-op flush still ensures load completed
    // Give the async load a tick; flush awaited ensureLoaded.
    expect(second.getWatermark(key)).toBe('2026-10-19T10:00:00Z')
    expect(second.hasFingerprint('abc123')).toBe(true)
  })

  it('file store starts empty when the file is missing', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'review-notifications-'))
    const store = createFileWatermarkStore(join(dir, 'nope', 'state.json'))
    expect(store.getWatermark('k')).toBeNull()
    expect(store.hasFingerprint('x')).toBe(false)
    await store.flush() // creates parent dirs
  })
})
