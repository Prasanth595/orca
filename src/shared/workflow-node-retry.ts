import type { WorkflowNode, WorkflowNodeType } from './workflow-types'

export type NodeRetryConfig = { retryCount: number; retryDelaySeconds: number }

export const DEFAULT_RETRY_DELAY_SECONDS = 1

export const RETRY_FIELD_KEYS: ReadonlySet<string> = new Set(['retryCount', 'retryDelaySeconds'])

const NON_RETRYABLE_TYPES: ReadonlySet<WorkflowNodeType> = new Set([
  'trigger_cron',
  'trigger_manual',
  'branch',
  'collect',
  'form_input'
])

export function nodeTypeSupportsRetry(type: WorkflowNodeType): boolean {
  return !NON_RETRYABLE_TYPES.has(type)
}

function nonNegative(value: unknown): number | undefined {
  const n = typeof value === 'string' && value.trim() !== '' ? Number(value) : value
  return typeof n === 'number' && Number.isFinite(n) && n >= 0 ? n : undefined
}

/** Parses retry values (numbers or form strings); invalid or missing ones fall back in order. */
export function parseRetryConfig(
  ...sources: { retryCount?: unknown; retryDelaySeconds?: unknown }[]
): NodeRetryConfig {
  let count: number | undefined
  let delay: number | undefined
  for (const source of sources) {
    count ??= nonNegative(source.retryCount)
    delay ??= nonNegative(source.retryDelaySeconds)
  }
  return {
    retryCount: Math.floor(count ?? 0),
    retryDelaySeconds: delay ?? DEFAULT_RETRY_DELAY_SECONDS
  }
}

/**
 * Retry settings live on the node itself. Older editor builds saved them inside
 * `node.data` instead, so that location is still honored when the node has none.
 */
export function getNodeRetryConfig(node: WorkflowNode): NodeRetryConfig {
  const legacy: Record<string, unknown> = node.data
  return parseRetryConfig(
    {
      retryCount: 'retryCount' in node ? node.retryCount : undefined,
      retryDelaySeconds: 'retryDelaySeconds' in node ? node.retryDelaySeconds : undefined
    },
    legacy
  )
}

/**
 * Merges an editor data patch into the node and stores retry settings on the node,
 * removing any copies older builds left inside `data`.
 */
export function applyNodeEdit(
  node: WorkflowNode,
  dataPatch: Record<string, unknown>,
  retryValues: { retryCount?: unknown; retryDelaySeconds?: unknown }
): Record<string, unknown> {
  const data = Object.fromEntries(
    Object.entries({ ...node.data, ...dataPatch }).filter(([k]) => !RETRY_FIELD_KEYS.has(k))
  )
  const retry = nodeTypeSupportsRetry(node.type) ? parseRetryConfig(retryValues) : {}
  return { ...node, data, ...retry }
}
