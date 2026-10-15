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
import { planeOperations, type PlaneOperations } from '../plane/plane-operations'

type Answer<K extends keyof PlaneOperations> = ReturnType<PlaneOperations[K]>

/** Plane on the runtime surface; the same operations back the desktop's IPC handlers. */
export class RuntimePlaneCommands {
  planeConnect(params: PlaneConnectParams, signal?: AbortSignal): Answer<'connect'> {
    return planeOperations.connect(params, signal)
  }

  planeStatus(): Answer<'status'> {
    return planeOperations.status()
  }

  planeDisconnect(params?: PlaneDisconnectParams): Answer<'disconnect'> {
    return planeOperations.disconnect(params)
  }

  planeSetProjectScope(params: PlaneSetProjectScopeParams): Answer<'setProjectScope'> {
    return planeOperations.setProjectScope(params)
  }

  planeListProjects(params: PlaneListProjectsParams, signal?: AbortSignal): Answer<'listProjects'> {
    return planeOperations.listProjects(params, signal)
  }

  planeListWorkItems(
    params: PlaneListWorkItemsParams,
    signal?: AbortSignal
  ): Answer<'listWorkItems'> {
    return planeOperations.listWorkItems(params, signal)
  }

  planeGetWorkItem(params: PlaneWorkItemRefParams, signal?: AbortSignal): Answer<'getWorkItem'> {
    return planeOperations.getWorkItem(params, signal)
  }

  planeLookupWorkItem(
    params: PlaneLookupIdentifierParams,
    signal?: AbortSignal
  ): Answer<'lookupWorkItem'> {
    return planeOperations.lookupWorkItem(params, signal)
  }

  planeListStates(params: PlaneProjectRefParams, signal?: AbortSignal): Answer<'listStates'> {
    return planeOperations.listStates(params, signal)
  }

  planeListMembers(params: PlaneProjectRefParams, signal?: AbortSignal): Answer<'listMembers'> {
    return planeOperations.listMembers(params, signal)
  }

  planeListComments(params: PlaneWorkItemRefParams, signal?: AbortSignal): Answer<'listComments'> {
    return planeOperations.listComments(params, signal)
  }

  planeUpdateState(params: PlaneUpdateStateParams, signal?: AbortSignal): Answer<'updateState'> {
    return planeOperations.updateState(params, signal)
  }

  planeAddComment(params: PlaneAddCommentParams, signal?: AbortSignal): Answer<'addComment'> {
    return planeOperations.addComment(params, signal)
  }
}
