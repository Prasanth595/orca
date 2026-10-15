import { expect, it } from 'vitest'
import { createChatCheckpointStore, type ChatCheckpoint } from './mobile-chat-checkpoint-store'

function storage() {
  const data = new Map<string, string>()
  return {
    data,
    getAllKeys: async () => [...data.keys()],
    getItem: async (key: string) => data.get(key) ?? null,
    setItem: async (key: string, value: string) => {
      data.set(key, value)
    },
    removeItem: async (key: string) => {
      data.delete(key)
    }
  }
}
const entry: ChatCheckpoint = {
  scope: 'paired-host',
  hostId: 'host',
  namespace: 'native-chat',
  key: 'session',
  value: { messages: ['hello'] },
  at: Date.now()
}
it('restores across process instances and isolates pairing scopes', async () => {
  const disk = storage()
  await createChatCheckpointStore(disk).write(entry)
  const reopened = createChatCheckpointStore(disk)
  expect(await reopened.read(entry)).toEqual(entry.value)
  expect(await reopened.read({ ...entry, scope: 'new-pairing' })).toBeNull()
})
it('deletion wins against pending and late writes', async () => {
  const disk = storage()
  const cache = createChatCheckpointStore(disk)
  const pending = cache.write(entry)
  const removal = cache.removeWhere((item) => item.key === 'session')
  await Promise.all([pending, removal])
  await cache.write(entry)
  expect(await cache.read(entry)).toBeNull()
  expect(await createChatCheckpointStore(disk).read(entry)).toBeNull()
})
it('bounds storage and deletes expired checkpoints on opening', async () => {
  const disk = storage()
  const cache = createChatCheckpointStore(disk)
  for (let i = 0; i < 70; i++) {
    await cache.write({ ...entry, key: String(i) })
  }
  expect(disk.data.size).toBeLessThanOrEqual(65)
  expect(await cache.read({ ...entry, key: '0' })).toBeNull()
  expect(await cache.read({ ...entry, key: '69' })).toEqual(entry.value)
  await cache.write({ ...entry, key: 'expired', at: Date.now() - 31 * 86400000 })
  expect(await createChatCheckpointStore(disk).read({ ...entry, key: 'expired' })).toBeNull()
})
it('recovers a damaged index without losing future writes', async () => {
  const disk = storage()
  disk.data.set('orca:chat-checkpoints:v2:index', '{broken')
  const cache = createChatCheckpointStore(disk)
  await cache.write(entry)
  expect(await cache.read(entry)).toEqual(entry.value)
})

it('removes orphan payloads left by an interrupted or damaged index', async () => {
  const disk = storage()
  disk.data.set('orca:chat-checkpoints:v2:123-0', '{}')
  await createChatCheckpointStore(disk).read(entry)
  expect(disk.data.size).toBe(1)
})

it('avoids payload id collisions when a process is recreated in the same millisecond', async () => {
  const disk = storage()
  await createChatCheckpointStore(disk).write(entry)
  const reopened = createChatCheckpointStore(disk)
  await reopened.write({ ...entry, key: 'other', value: 'other' })
  const again = createChatCheckpointStore(disk)
  expect(await again.read(entry)).toEqual(entry.value)
  expect(await again.read({ ...entry, key: 'other' })).toBe('other')
})

it('enforces the total byte budget even below the record count cap', async () => {
  const disk = storage()
  const cache = createChatCheckpointStore(disk)
  for (let i = 0; i < 24; i++) {
    await cache.write({ ...entry, key: String(i), value: 'x'.repeat(400000) })
  }
  const bytes = [...disk.data.values()].reduce((total, value) => total + value.length * 2, 0)
  expect(bytes).toBeLessThan(16 * 1024 * 1024 + 4096)
  expect(await cache.read({ ...entry, key: '0' })).toBeNull()
})
