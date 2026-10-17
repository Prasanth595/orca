import type { ZodType } from 'zod'
import { LOCAL_EXECUTION_HOST_ID } from '../../../../shared/execution-host'
import { localPerforceBackend } from '../../../../shared/perforce/perforce-backend'
import {
  PERFORCE_OPERATIONS,
  type PerforceOperationName
} from '../../../../shared/perforce/perforce-operations'
import { runWithPerforceSettings } from '../../../../shared/perforce/p4-settings-context'
import { normalizePerforceSettings } from '../../../../shared/perforce/perforce-settings'
import {
  PerforceChangelistFilesParams,
  PerforceChangelistParams,
  PerforceCreateChangelistParams,
  PerforceDiscardParams,
  PerforceEditDescriptionParams,
  PerforceFilePathParams,
  PerforceFilePathsParams,
  PerforceHistoryParams,
  PerforceMoveToChangelistParams,
  PerforceSubmitParams,
  PerforceUnshelveFilesParams,
  PerforceUnshelveFromParams,
  PerforceWorkspaceParams
} from '../../../../shared/rpc-contract/perforce-params'
import { ExecutionHostNotDispatchableError } from '../../../providers/execution-host-provider-dispatch'
import type { OrcaRuntimeService } from '../../orca-runtime'
import { defineMethod } from '../core'

/** Fields every perforce.* method carries; the rest is validated by the operation itself. */
type PerforceRpcParams = { worktree: string; settings?: unknown }

type PerforceRuntime = Pick<OrcaRuntimeService, 'resolveRuntimeFileTarget'>

/** Runs one Perforce operation in a workspace this server hosts, with the caller's p4 settings. */
export async function runRuntimePerforceOperation(
  runtime: PerforceRuntime,
  operation: PerforceOperationName,
  params: PerforceRpcParams
): Promise<unknown> {
  const target = await runtime.resolveRuntimeFileTarget(params.worktree)
  // Why: p4 runs where this server runs; a workspace another host owns must not run here.
  if (target.executionHostId !== LOCAL_EXECUTION_HOST_ID) {
    throw new ExecutionHostNotDispatchableError(target.executionHostId)
  }
  return runWithPerforceSettings(normalizePerforceSettings(params.settings), () =>
    PERFORCE_OPERATIONS[operation](localPerforceBackend, target.worktree.path, { ...params })
  )
}

function perforceMethod<
  Operation extends PerforceOperationName,
  Schema extends ZodType<PerforceRpcParams>
>(operation: Operation, params: Schema) {
  const name: `perforce.${Operation}` = `perforce.${operation}`
  return defineMethod({
    name,
    permission: 'workspace',
    params,
    handler: (parsed, { runtime }) => runRuntimePerforceOperation(runtime, operation, parsed)
  })
}

export const PERFORCE_METHODS = [
  perforceMethod('detect', PerforceWorkspaceParams),
  perforceMethod('info', PerforceWorkspaceParams),
  perforceMethod('status', PerforceWorkspaceParams),
  perforceMethod('history', PerforceHistoryParams),
  perforceMethod('diff', PerforceFilePathParams),
  perforceMethod('diffText', PerforceFilePathsParams),
  perforceMethod('isReadOnlyFile', PerforceFilePathParams),
  perforceMethod('checkoutIfReadOnly', PerforceFilePathParams),
  perforceMethod('open', PerforceFilePathsParams),
  perforceMethod('edit', PerforceFilePathsParams),
  perforceMethod('close', PerforceFilePathsParams),
  perforceMethod('discard', PerforceDiscardParams),
  perforceMethod('submit', PerforceSubmitParams),
  perforceMethod('sync', PerforceWorkspaceParams),
  perforceMethod('shelve', PerforceChangelistParams),
  perforceMethod('unshelve', PerforceChangelistParams),
  perforceMethod('unshelveFrom', PerforceUnshelveFromParams),
  perforceMethod('shelveAndRevertFiles', PerforceChangelistFilesParams),
  perforceMethod('unshelveFiles', PerforceUnshelveFilesParams),
  perforceMethod('deleteChangelistWithFiles', PerforceChangelistParams),
  perforceMethod('deleteShelf', PerforceChangelistParams),
  perforceMethod('createChangelist', PerforceCreateChangelistParams),
  perforceMethod('editDescription', PerforceEditDescriptionParams),
  perforceMethod('moveToChangelist', PerforceMoveToChangelistParams),
  perforceMethod('deleteChangelist', PerforceChangelistParams),
  perforceMethod('describeChange', PerforceChangelistParams)
]
