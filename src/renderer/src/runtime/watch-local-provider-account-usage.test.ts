// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { RuntimeRpcResponse } from '../../../shared/runtime-rpc-envelope'
import { createEmptyRateLimitState } from '../../../shared/rate-limit-state-factory'
import {
  watchProviderAccounts,
  type ProviderAccountsSnapshot
} from './runtime-provider-accounts-client'

let emit: (response: RuntimeRpcResponse<unknown>) => void
let resolveHandle: (handle: { unsubscribe: () => void; sendBinary: () => void }) => void
const unsubscribe = vi.fn()
const onSnapshot = vi.fn()
const onError = vi.fn()
const snapshot: ProviderAccountsSnapshot = {
  claude: { accounts: [], activeAccountId: 'claude-a' },
  codex: { accounts: [], activeAccountId: 'codex-a' },
  rateLimits: createEmptyRateLimitState()
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.clearAllMocks()
  Object.assign(window, {
    api: {
      runtime: {
        subscribe: vi.fn((_args, callback) => {
          emit = callback
          return new Promise((resolve) => {
            resolveHandle = resolve
          })
        })
      }
    }
  })
})
afterEach(() => {
  vi.useRealTimers()
  Reflect.deleteProperty(window, 'api')
})

it('streams the local account identity and usage together without calling account selection', async () => {
  const watcher = watchProviderAccounts(
    { kind: 'local' },
    { onSnapshot, onError },
    { liveUsage: true }
  )
  emit({
    id: 'accounts',
    _meta: { runtimeId: 'local' },
    ok: true,
    result: { type: 'ready', snapshot }
  })
  expect(onSnapshot).toHaveBeenCalledWith(snapshot)
  emit({
    id: 'accounts',
    _meta: { runtimeId: 'local' },
    ok: true,
    result: {
      type: 'snapshot',
      snapshot: { ...snapshot, codex: { accounts: [], activeAccountId: 'codex-b' } }
    }
  })
  expect(onSnapshot).toHaveBeenCalledTimes(2)
  await vi.advanceTimersByTimeAsync(15_000)
  expect(onError).not.toHaveBeenCalled()
  resolveHandle({ unsubscribe, sendBinary: vi.fn() })
  await Promise.resolve()
  watcher.close()
  expect(unsubscribe).toHaveBeenCalledOnce()
  emit({
    id: 'accounts',
    _meta: { runtimeId: 'local' },
    ok: true,
    result: { type: 'snapshot', snapshot }
  })
  expect(onSnapshot).toHaveBeenCalledTimes(2)
})

it('unsubscribes a late handle and drops late messages after the owner changes', async () => {
  const watcher = watchProviderAccounts(
    { kind: 'local' },
    { onSnapshot, onError },
    { liveUsage: true }
  )
  watcher.close()
  emit({
    id: 'accounts',
    _meta: { runtimeId: 'local' },
    ok: true,
    result: { type: 'ready', snapshot }
  })
  resolveHandle({ unsubscribe, sendBinary: vi.fn() })
  await Promise.resolve()
  await vi.advanceTimersByTimeAsync(15_000)
  expect(unsubscribe).toHaveBeenCalledOnce()
  expect(onSnapshot).not.toHaveBeenCalled()
  expect(onError).not.toHaveBeenCalled()
})

it('reports a silent subscription so missing usage is recoverable', async () => {
  const watcher = watchProviderAccounts(
    { kind: 'local' },
    { onSnapshot, onError },
    { liveUsage: true }
  )
  await vi.advanceTimersByTimeAsync(15_000)
  expect(onError).toHaveBeenCalledOnce()
  watcher.close()
})
