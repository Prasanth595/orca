import type {
  FeishuBitableTableDiscoveryArgs,
  FeishuBitableTableDiscoveryResult
} from '../../../shared/feishu-bitable-table-discovery'
import type {
  FeishuBitableConnectResult,
  FeishuBitableCompleteArgs,
  FeishuBitableCompleteResult,
  FeishuBitableConnectionStatus,
  FeishuBitableField,
  FeishuBitableFieldMapping,
  FeishuBitableReadResult,
  FeishuBitableRecordResult
} from '../../../shared/feishu-bitable-types'
import { parseFeishuBitableConnectionStatus } from '../../../shared/feishu-bitable-types'
import { rowLessSourceTarget, type RowLessSource } from '@/lib/default-creation-host'
import { callRuntimeRpc } from './runtime-rpc-client'
import { RuntimeRpcCallError } from './runtime-rpc-result'

export type RuntimeFeishuBitableSettings = RowLessSource

export function getFeishuBitableRuntimeTarget(source: RuntimeFeishuBitableSettings) {
  return rowLessSourceTarget(source)
}

/**
 * Older Orca hosts predate the Feishu Bitable methods; a method_not_found
 * failure must read as "upgrade the host", not as a generic broken read.
 */
export function isFeishuBitableUnsupportedHostError(error: unknown): boolean {
  return error instanceof RuntimeRpcCallError && error.code === 'method_not_found'
}

export function feishuBitableUnsupportedHostMessage(): string {
  return 'Feishu Bitable is not available on this Orca host. Update Orca on the remote host first.'
}

async function dispatch<TResult>(
  target: ReturnType<typeof getFeishuBitableRuntimeTarget>,
  method: string,
  args: unknown,
  timeoutMs: number
): Promise<TResult> {
  try {
    return await callRuntimeRpc<TResult>(target, method, args, { timeoutMs })
  } catch (error) {
    if (isFeishuBitableUnsupportedHostError(error)) {
      throw new Error(feishuBitableUnsupportedHostMessage())
    }
    throw error
  }
}

export async function feishuBitableStatus(
  settings: RuntimeFeishuBitableSettings
): Promise<FeishuBitableConnectionStatus> {
  const target = getFeishuBitableRuntimeTarget(settings)
  return parseFeishuBitableConnectionStatus(
    target.kind === 'environment'
      ? await dispatch<unknown>(target, 'feishuBitable.status', undefined, 15_000)
      : await window.api.feishuBitable.status()
  )
}

export async function feishuBitableConnect(
  settings: RuntimeFeishuBitableSettings,
  args: {
    label?: string
    appId: string
    appSecret: string
    appToken: string
    tableId: string
    viewId?: string
    fieldMapping?: FeishuBitableFieldMapping
  }
): Promise<FeishuBitableConnectResult> {
  const target = getFeishuBitableRuntimeTarget(settings)
  return target.kind === 'environment'
    ? dispatch<FeishuBitableConnectResult>(target, 'feishuBitable.connect', args, 30_000)
    : window.api.feishuBitable.connect(args)
}

export async function feishuBitableDisconnect(
  settings: RuntimeFeishuBitableSettings,
  connectionId?: string | null
): Promise<void> {
  const target = getFeishuBitableRuntimeTarget(settings)
  if (target.kind === 'environment') {
    await dispatch<{ ok: true }>(
      target,
      'feishuBitable.disconnect',
      connectionId ? { connectionId } : undefined,
      15_000
    )
    return
  }
  await window.api.feishuBitable.disconnect(connectionId ? { connectionId } : undefined)
}

export async function feishuBitableSelectConnection(
  settings: RuntimeFeishuBitableSettings,
  connectionId: string | null
): Promise<FeishuBitableConnectionStatus> {
  const target = getFeishuBitableRuntimeTarget(settings)
  return parseFeishuBitableConnectionStatus(
    target.kind === 'environment'
      ? await dispatch<unknown>(target, 'feishuBitable.selectConnection', { connectionId }, 15_000)
      : await window.api.feishuBitable.selectConnection({ connectionId })
  )
}

export async function feishuBitableListRecords(
  settings: RuntimeFeishuBitableSettings,
  args?: { connectionId?: string | null; pageToken?: string | null; pageSize?: number }
): Promise<FeishuBitableReadResult> {
  const target = getFeishuBitableRuntimeTarget(settings)
  return target.kind === 'environment'
    ? dispatch<FeishuBitableReadResult>(target, 'feishuBitable.listRecords', args, 30_000)
    : window.api.feishuBitable.listRecords(
        args
          ? {
              connectionId: args.connectionId ?? undefined,
              pageToken: args.pageToken ?? undefined,
              pageSize: args.pageSize
            }
          : undefined
      )
}

export async function feishuBitableGetRecord(
  settings: RuntimeFeishuBitableSettings,
  args: { connectionId?: string | null; recordId: string }
): Promise<FeishuBitableRecordResult> {
  const target = getFeishuBitableRuntimeTarget(settings)
  return target.kind === 'environment'
    ? dispatch<FeishuBitableRecordResult>(target, 'feishuBitable.getRecord', args, 30_000)
    : window.api.feishuBitable.getRecord({
        connectionId: args.connectionId ?? undefined,
        recordId: args.recordId
      })
}

export async function feishuBitableListFields(
  settings: RuntimeFeishuBitableSettings,
  connectionId?: string | null
): Promise<{ ok: true; fields: FeishuBitableField[] } | { ok: false; error: string }> {
  const target = getFeishuBitableRuntimeTarget(settings)
  return target.kind === 'environment'
    ? dispatch<{ ok: true; fields: FeishuBitableField[] } | { ok: false; error: string }>(
        target,
        'feishuBitable.listFields',
        connectionId ? { connectionId } : undefined,
        30_000
      )
    : window.api.feishuBitable.listFields(connectionId ? { connectionId } : undefined)
}

export async function feishuBitableUpdateFieldMapping(
  settings: RuntimeFeishuBitableSettings,
  args: { connectionId: string; fieldMapping: FeishuBitableFieldMapping }
): Promise<{ ok: true } | { ok: false; error: string }> {
  const target = getFeishuBitableRuntimeTarget(settings)
  return target.kind === 'environment'
    ? dispatch<{ ok: true } | { ok: false; error: string }>(
        target,
        'feishuBitable.updateFieldMapping',
        args,
        15_000
      )
    : window.api.feishuBitable.updateFieldMapping(args)
}

export async function feishuBitableDiscoverTables(
  settings: RuntimeFeishuBitableSettings,
  args: FeishuBitableTableDiscoveryArgs
): Promise<FeishuBitableTableDiscoveryResult> {
  const target = getFeishuBitableRuntimeTarget(settings)
  return target.kind === 'environment'
    ? dispatch<FeishuBitableTableDiscoveryResult>(
        target,
        'feishuBitable.discoverTables',
        args,
        30_000
      )
    : window.api.feishuBitable.discoverTables(args)
}

export async function feishuBitableCompleteRecord(
  source: RuntimeFeishuBitableSettings,
  args: FeishuBitableCompleteArgs
): Promise<FeishuBitableCompleteResult> {
  const target = getFeishuBitableRuntimeTarget(source)
  return target.kind === 'environment'
    ? dispatch<FeishuBitableCompleteResult>(target, 'feishuBitable.completeRecord', args, 30_000)
    : window.api.feishuBitable.completeRecord(args)
}
