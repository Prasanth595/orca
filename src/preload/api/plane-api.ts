import type {
  PlaneAddCommentParams,
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
  PlaneHostKind,
  PlaneMember,
  PlaneProject,
  PlaneResult,
  PlaneState,
  PlaneWorkItem,
  PlaneWorkItemDetail,
  PlaneWorkItemList
} from '../../shared/plane-types'

/** A new token for one workspace; it goes to the host once and never comes back. */
export type PlaneConnectWithTokenArgs = {
  hostKind: PlaneHostKind
  serverUrl?: string
  apiBaseUrl?: string
  workspaceSlug: string
  apiToken: string
  insecureHttpAcknowledged?: boolean
}

/** Another workspace on a saved connection's server, using that connection's token on the host. */
export type PlaneConnectReusingTokenArgs = {
  reuseTokenFromConnectionId: string
  workspaceSlug: string
}

export type PlaneConnectArgs = PlaneConnectWithTokenArgs | PlaneConnectReusingTokenArgs

export type PlaneApi = {
  connect: (args: PlaneConnectArgs) => Promise<PlaneConnectResult>
  status: () => Promise<PlaneConnectionStatus>
  /** One workspace, or every workspace when no connectionId is given. */
  disconnect: (args?: { connectionId?: string }) => Promise<PlaneConnectionStatus>
  setProjectScope: (args: PlaneSetProjectScopeParams) => Promise<PlaneResult<PlaneConnectionStatus>>
  listProjects: (args?: PlaneListProjectsParams) => Promise<PlaneResult<PlaneProject[]>>
  listWorkItems: (args?: PlaneListWorkItemsParams) => Promise<PlaneResult<PlaneWorkItemList>>
  getWorkItem: (args: PlaneWorkItemRefParams) => Promise<PlaneResult<PlaneWorkItemDetail>>
  lookupWorkItem: (args: PlaneLookupIdentifierParams) => Promise<PlaneResult<PlaneWorkItemDetail>>
  listStates: (args: PlaneProjectRefParams) => Promise<PlaneResult<PlaneState[]>>
  listMembers: (args: PlaneProjectRefParams) => Promise<PlaneResult<PlaneMember[]>>
  listComments: (args: PlaneWorkItemRefParams) => Promise<PlaneResult<PlaneComment[]>>
  updateState: (args: PlaneUpdateStateParams) => Promise<PlaneResult<PlaneWorkItem>>
  addComment: (args: PlaneAddCommentParams) => Promise<PlaneResult<PlaneComment>>
}
