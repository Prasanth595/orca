import type { RuntimeWorktreeRecord } from '../../shared/runtime-types'
import { getOptionalStringFlag } from '../flags'
import { formatWorktreeShow, printResult } from '../format'
import type { RuntimeClient, RuntimeRpcSuccess } from '../runtime-client'
import {
  getDefaultWorkspaceStatusId,
  normalizeWorkspaceStatuses
} from '../../shared/workspace-statuses'

// Why: the board files an unknown id under its default column, so `--workspace-status done`
// (the id is `completed`) succeeds while the card never moves. Warn rather than reject: the
// write is harmless, and an older or restricted runtime may not report its columns.
export async function findUnknownWorkspaceStatusWarning(
  client: Pick<RuntimeClient, 'call'>,
  statusId: string | undefined
): Promise<string | null> {
  if (statusId === undefined) {
    return null
  }
  let rawStatuses: unknown
  try {
    const response = await client.call<{ ui?: { workspaceStatuses?: unknown } }>('ui.get')
    rawStatuses = response.result.ui?.workspaceStatuses
  } catch {
    return null
  }
  if (rawStatuses === undefined) {
    return null
  }
  const statuses = normalizeWorkspaceStatuses(rawStatuses)
  if (statuses.some((status) => status.id === statusId)) {
    return null
  }
  const fallbackId = getDefaultWorkspaceStatusId(statuses)
  const fallbackLabel = statuses.find((status) => status.id === fallbackId)?.label ?? fallbackId
  const ids = statuses.map((status) => status.id).join(', ')
  return `workspace status "${statusId}" is not a board column, so the board shows this workspace under "${fallbackLabel}". Board column ids: ${ids}.`
}

export async function printWorktreeSetResult(
  response: RuntimeRpcSuccess<{ worktree: RuntimeWorktreeRecord }>,
  context: {
    client: Pick<RuntimeClient, 'call'>
    flags: Map<string, string | boolean>
    json: boolean
  }
): Promise<void> {
  const warning = await findUnknownWorkspaceStatusWarning(
    context.client,
    getOptionalStringFlag(context.flags, 'workspace-status')
  )
  if (!warning) {
    printResult(response, context.json, formatWorktreeShow)
    return
  }
  if (!context.json) {
    console.error(`warning: ${warning}`)
  }
  printResult(attachWorkspaceStatusWarning(response, warning), context.json, formatWorktreeShow)
}

// Why: agents read --json, where stderr warnings are easy to drop, so the warning rides in the result.
export function attachWorkspaceStatusWarning<TResult extends object>(
  response: RuntimeRpcSuccess<TResult>,
  warning: string
): RuntimeRpcSuccess<TResult & { warning: string }> {
  return { ...response, result: { ...response.result, warning } }
}
