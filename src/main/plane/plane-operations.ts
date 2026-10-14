import type {
  PlaneAddCommentParams,
  PlaneConnectParams,
  PlaneDisconnectParams,
  PlaneListProjectsParams,
  PlaneListWorkItemsParams,
  PlaneLookupIdentifierParams,
  PlaneProjectRefParams,
  PlaneSetProjectScopeParams,
  PlaneUpdateStateParams,
  PlaneWorkItemRefParams
} from '../../shared/rpc-contract/plane-params'
import type {
  PlaneComment,
  PlaneConnectResult,
  PlaneConnectionStatus,
  PlaneMember,
  PlaneProject,
  PlaneResult,
  PlaneState,
  PlaneWorkItem,
  PlaneWorkItemDetail,
  PlaneWorkItemList
} from '../../shared/plane-types'
import { CredentialDecryptionError } from '../integration-credential-file'
import { isPlaneApiError } from './plane-api-error'
import {
  planeConnect,
  planeDisconnect,
  planeListProjects,
  planeSetProjectScope,
  planeStatus
} from './plane-commands'
import { redactPlaneSecrets } from './plane-redact'
import { PlaneNotConnectedError } from './plane-session'
import {
  planeAddComment,
  planeGetWorkItem,
  planeListComments,
  planeListMembers,
  planeListStates,
  planeListWorkItems,
  planeLookupWorkItem,
  planeUpdateState
} from './plane-work-item-commands'

// Why one entry point for IPC and runtime RPC: both transports must accept the same params,
// answer in the same envelope and keep the token out of every result and error alike.

async function planeResult<T>(run: () => T | Promise<T>): Promise<PlaneResult<T>> {
  try {
    return { ok: true, value: await run() }
  } catch (error) {
    if (isPlaneApiError(error)) {
      return { ok: false, error: { kind: error.kind, message: error.message } }
    }
    if (error instanceof PlaneNotConnectedError) {
      return { ok: false, error: { kind: 'not_connected', message: error.message } }
    }
    if (error instanceof CredentialDecryptionError) {
      return { ok: false, error: { kind: 'credential_unreadable', message: error.message } }
    }
    // Aborts and programming errors stay exceptions, but never carry a token out.
    if (error instanceof Error && error.name !== 'AbortError') {
      throw new Error(redactPlaneSecrets(error.message))
    }
    throw error
  }
}

export const planeOperations = {
  async connect(params: PlaneConnectParams, signal?: AbortSignal): Promise<PlaneConnectResult> {
    try {
      return await planeConnect(params, signal)
    } catch (error) {
      if (error instanceof Error && error.name !== 'AbortError') {
        throw new Error(
          redactPlaneSecrets(error.message, 'apiToken' in params ? [params.apiToken] : [])
        )
      }
      throw error
    }
  },
  status: (): PlaneConnectionStatus => planeStatus(),
  disconnect: (params?: PlaneDisconnectParams): PlaneConnectionStatus => planeDisconnect(params),
  setProjectScope: (
    params: PlaneSetProjectScopeParams
  ): Promise<PlaneResult<PlaneConnectionStatus>> => planeResult(() => planeSetProjectScope(params)),
  listProjects: (
    params: PlaneListProjectsParams,
    signal?: AbortSignal
  ): Promise<PlaneResult<PlaneProject[]>> =>
    planeResult(() =>
      planeListProjects({
        refresh: params?.refresh === true,
        connectionId: params?.connectionId,
        signal
      })
    ),
  listWorkItems: (
    params: PlaneListWorkItemsParams,
    signal?: AbortSignal
  ): Promise<PlaneResult<PlaneWorkItemList>> =>
    planeResult(() => planeListWorkItems(params, signal)),
  getWorkItem: (
    params: PlaneWorkItemRefParams,
    signal?: AbortSignal
  ): Promise<PlaneResult<PlaneWorkItemDetail>> =>
    planeResult(() => planeGetWorkItem(params, signal)),
  lookupWorkItem: (
    params: PlaneLookupIdentifierParams,
    signal?: AbortSignal
  ): Promise<PlaneResult<PlaneWorkItemDetail>> =>
    planeResult(() => planeLookupWorkItem(params, signal)),
  listStates: (
    params: PlaneProjectRefParams,
    signal?: AbortSignal
  ): Promise<PlaneResult<PlaneState[]>> => planeResult(() => planeListStates(params, signal)),
  listMembers: (
    params: PlaneProjectRefParams,
    signal?: AbortSignal
  ): Promise<PlaneResult<PlaneMember[]>> => planeResult(() => planeListMembers(params, signal)),
  listComments: (
    params: PlaneWorkItemRefParams,
    signal?: AbortSignal
  ): Promise<PlaneResult<PlaneComment[]>> => planeResult(() => planeListComments(params, signal)),
  updateState: (
    params: PlaneUpdateStateParams,
    signal?: AbortSignal
  ): Promise<PlaneResult<PlaneWorkItem>> => planeResult(() => planeUpdateState(params, signal)),
  addComment: (
    params: PlaneAddCommentParams,
    signal?: AbortSignal
  ): Promise<PlaneResult<PlaneComment>> => planeResult(() => planeAddComment(params, signal))
}

export type PlaneOperations = typeof planeOperations
