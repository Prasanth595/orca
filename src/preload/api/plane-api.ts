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

/** What the renderer sends to connect; the token goes to main once and never comes back. */
export type PlaneConnectArgs = {
  hostKind: PlaneHostKind
  serverUrl?: string
  apiBaseUrl?: string
  workspaceSlug: string
  apiToken: string
  insecureHttpAcknowledged?: boolean
}

export type PlaneApi = {
  connect: (args: PlaneConnectArgs) => Promise<PlaneConnectResult>
  status: () => Promise<PlaneConnectionStatus>
  disconnect: () => Promise<PlaneConnectionStatus>
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
