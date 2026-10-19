import type { ExecutionHostScope } from '../../../shared/execution-host'
import type { TaskProviderIdentity } from '../../../shared/task-source-context'
import {
  getAccountBackedTaskSourceSummary,
  type TaskSourceContextSummary,
  type TaskSourceHostAvailability
} from './task-source-context-summary'

type HostLabelLookup = ReadonlyMap<string, string> | undefined

// Why: local boards have no account or repo scope; the board renders under the host label only.
export function getLocalTaskSourceSummary(args: {
  providerLabel: string
  hostAvailability?: readonly TaskSourceHostAvailability[]
  hostLabelById?: HostLabelLookup
  accountHostId?: ExecutionHostScope | null
}): TaskSourceContextSummary {
  return getAccountBackedTaskSourceSummary(args.providerLabel, {
    accountLabel: null,
    accountHostId: args.accountHostId,
    hostLabelById: args.hostLabelById,
    hostAvailability: args.hostAvailability
  })
}

export function getProviderIdentityLabel(
  identity: TaskProviderIdentity | null | undefined
): string | null {
  switch (identity?.provider) {
    case 'local':
      return identity.boardId ?? null
    case 'github':
      return `${identity.owner}/${identity.repo}`
    case 'gitlab':
      return identity.namespace && identity.project
        ? `${identity.namespace}/${identity.project}`
        : (identity.projectId ?? null)
    case 'linear':
      return identity.workspaceName ?? identity.workspaceId ?? null
    case 'jira':
      return identity.siteUrl ?? identity.siteId ?? null
    default:
      return null
  }
}
