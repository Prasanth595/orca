// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  feishuBitableCompleteRecord,
  feishuBitableListRecords
} from './runtime-feishu-bitable-client'
import { RuntimeRpcCallError } from './runtime-rpc-result'
const rpc = vi.hoisted(() => vi.fn())
vi.mock('./runtime-rpc-client', () => ({ callRuntimeRpc: rpc }))
const local = vi.fn()
const reference = { connectionId: 'c', appToken: 'a', tableId: 't', recordId: 'r' }
beforeEach(() => {
  vi.resetAllMocks()
  vi.stubGlobal('window', { api: { feishuBitable: { completeRecord: local } } })
})
afterEach(() => vi.unstubAllGlobals())
describe('Feishu completion host ownership', () => {
  it('routes a local folder source through local IPC', async () => {
    local.mockResolvedValue({ ok: true })
    await feishuBitableCompleteRecord({ kind: 'local' }, { record: reference })
    expect(local).toHaveBeenCalledWith({ record: reference })
    expect(rpc).not.toHaveBeenCalled()
  })
  it('routes to the explicitly selected SSH host without sending credentials', async () => {
    rpc.mockResolvedValue({ ok: true })
    const target = { kind: 'environment', environmentId: 'ssh-host' } as const
    await feishuBitableCompleteRecord(target, { record: reference })
    expect(rpc).toHaveBeenCalledWith(
      target,
      'feishuBitable.completeRecord',
      { record: reference },
      { timeoutMs: 30000 }
    )
    expect(local).not.toHaveBeenCalled()
  })
  it('degrades old-host writes without falling back to local credentials or disabling reads', async () => {
    rpc.mockRejectedValueOnce(
      new RuntimeRpcCallError({
        ok: false,
        id: 'request',
        error: { code: 'method_not_found', message: 'Unknown method' }
      })
    )
    const target = { kind: 'environment', environmentId: 'older-host' } as const
    await expect(feishuBitableCompleteRecord(target, { record: reference })).rejects.toThrow(
      'Update Orca on the remote host'
    )
    rpc.mockResolvedValueOnce({ ok: true, page: { tasks: [] } })
    expect(await feishuBitableListRecords(target)).toMatchObject({ ok: true })
    expect(local).not.toHaveBeenCalled()
  })
  it('propagates remote contact loss without retrying writes elsewhere', async () => {
    rpc.mockRejectedValueOnce(new Error('Disconnected'))
    await expect(
      feishuBitableCompleteRecord(
        { kind: 'environment', environmentId: 'offline' },
        { record: reference }
      )
    ).rejects.toThrow('Disconnected')
    expect(rpc).toHaveBeenCalledTimes(1)
    expect(local).not.toHaveBeenCalled()
  })
})
