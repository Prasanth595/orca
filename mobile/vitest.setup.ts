import { vi } from 'vitest'

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })

// `expo-crypto` is a native module with no Node build, and `randomV4Uuid` reaches it from shared
// code; tests get Node's secure bytes. A test file's own mock of it still wins.
vi.mock('expo-crypto', async () => {
  const { randomBytes } = await import('node:crypto')
  return { getRandomBytes: (count: number) => new Uint8Array(randomBytes(count)) }
})
