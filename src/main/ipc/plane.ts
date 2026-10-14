import { ipcMain } from 'electron'
import type { z } from 'zod'
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
} from '../../shared/rpc-contract/plane-params'
import { planeOperations } from '../plane/plane-operations'

export class PlaneIpcValidationError extends Error {
  constructor(channel: string, issue: string | undefined) {
    super(`Invalid ${channel} request${issue ? `: ${issue}` : '.'}`)
    this.name = 'PlaneIpcValidationError'
  }
}

/** Parses with the runtime RPC schema, so a bad payload stops here on either transport. */
function parsePlaneArgs<S extends z.ZodType>(
  channel: string,
  schema: S,
  args: unknown
): z.output<S> {
  const parsed = schema.safeParse(args)
  if (!parsed.success) {
    // Why only the issue message: zod's default output can echo the input, i.e. the token.
    throw new PlaneIpcValidationError(channel, parsed.error.issues[0]?.message)
  }
  return parsed.data
}

function handle<S extends z.ZodType>(
  channel: string,
  schema: S,
  run: (params: z.output<S>) => unknown
): void {
  ipcMain.handle(channel, (_event, args: unknown) => run(parsePlaneArgs(channel, schema, args)))
}

export function registerPlaneHandlers(): void {
  handle('plane:connect', Connect, (params) => planeOperations.connect(params))
  ipcMain.handle('plane:status', () => planeOperations.status())
  ipcMain.handle('plane:disconnect', () => planeOperations.disconnect())
  handle('plane:setProjectScope', SetProjectScope, (params) =>
    planeOperations.setProjectScope(params)
  )
  handle('plane:listProjects', ListProjects, (params) => planeOperations.listProjects(params))
  handle('plane:listWorkItems', ListWorkItems, (params) => planeOperations.listWorkItems(params))
  handle('plane:getWorkItem', WorkItemRef, (params) => planeOperations.getWorkItem(params))
  handle('plane:lookupWorkItem', LookupIdentifier, (params) =>
    planeOperations.lookupWorkItem(params)
  )
  handle('plane:listStates', ProjectRef, (params) => planeOperations.listStates(params))
  handle('plane:listMembers', ProjectRef, (params) => planeOperations.listMembers(params))
  handle('plane:listComments', WorkItemRef, (params) => planeOperations.listComments(params))
  handle('plane:updateState', UpdateState, (params) => planeOperations.updateState(params))
  handle('plane:addComment', AddComment, (params) => planeOperations.addComment(params))
}
