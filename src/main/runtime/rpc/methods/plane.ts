import {
  AddComment,
  Connect,
  ListProjects,
  ListWorkItems,
  LookupIdentifier,
  ProjectRef,
  SetProjectScope,
  UpdateState,
  WorkItemRef
} from '../../../../shared/rpc-contract/plane-params'
import { defineMethod, defineStreamingMethod } from '../core'
import { emitChunkedJsonPayload } from './chunked-json-payload'

// Why accounts-admin for connect/disconnect/scope: they change the credential the host holds
// and, through the URL, which server it talks to, so they must not ride workspace access.
export const PLANE_METHODS = [
  defineMethod({
    name: 'plane.connect',
    permission: 'accounts-admin',
    params: Connect,
    handler: (params, { runtime, signal }) => runtime.planeConnect(params, signal)
  }),
  defineMethod({
    name: 'plane.disconnect',
    permission: 'accounts-admin',
    params: null,
    handler: async (_params, { runtime }) => runtime.planeDisconnect()
  }),
  defineMethod({
    name: 'plane.setProjectScope',
    permission: 'accounts-admin',
    params: SetProjectScope,
    handler: (params, { runtime }) => runtime.planeSetProjectScope(params)
  }),
  defineMethod({
    name: 'plane.status',
    permission: 'workspace',
    params: null,
    handler: async (_params, { runtime }) => runtime.planeStatus()
  }),
  defineMethod({
    name: 'plane.listProjects',
    permission: 'workspace',
    params: ListProjects,
    handler: (params, { runtime, signal }) => runtime.planeListProjects(params, signal)
  }),
  // Streamed in chunks: up to 500 items can approach the 1 MiB remote frame cap.
  defineStreamingMethod({
    name: 'plane.listWorkItems',
    permission: 'workspace',
    params: ListWorkItems,
    handler: async (params, { runtime, signal }, emit) => {
      emitChunkedJsonPayload(await runtime.planeListWorkItems(params, signal), emit, 'Plane')
    }
  }),
  defineMethod({
    name: 'plane.getWorkItem',
    permission: 'workspace',
    params: WorkItemRef,
    handler: (params, { runtime, signal }) => runtime.planeGetWorkItem(params, signal)
  }),
  defineMethod({
    name: 'plane.lookupWorkItem',
    permission: 'workspace',
    params: LookupIdentifier,
    handler: (params, { runtime, signal }) => runtime.planeLookupWorkItem(params, signal)
  }),
  defineMethod({
    name: 'plane.listStates',
    permission: 'workspace',
    params: ProjectRef,
    handler: (params, { runtime, signal }) => runtime.planeListStates(params, signal)
  }),
  defineMethod({
    name: 'plane.listMembers',
    permission: 'workspace',
    params: ProjectRef,
    handler: (params, { runtime, signal }) => runtime.planeListMembers(params, signal)
  }),
  defineMethod({
    name: 'plane.listComments',
    permission: 'workspace',
    params: WorkItemRef,
    handler: (params, { runtime, signal }) => runtime.planeListComments(params, signal)
  }),
  defineMethod({
    name: 'plane.updateState',
    permission: 'workspace',
    params: UpdateState,
    handler: (params, { runtime, signal }) => runtime.planeUpdateState(params, signal)
  }),
  defineMethod({
    name: 'plane.addComment',
    permission: 'workspace',
    params: AddComment,
    handler: (params, { runtime, signal }) => runtime.planeAddComment(params, signal)
  })
]
