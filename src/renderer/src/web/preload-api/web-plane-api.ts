import type { PreloadApi } from '../../../../preload/api-types'
import { readRuntimeJiraPayload } from '../../runtime/runtime-jira-payload-stream'
import { callRuntimeResult } from './web-runtime-calls'
import { requireActiveEnvironment } from './web-runtime-session'

const PLANE_NETWORK_TIMEOUT_MS = 30_000
const PLANE_SETTINGS_TIMEOUT_MS = 15_000

function planeCall<TResult>(
  method: string,
  params?: unknown,
  timeoutMs = PLANE_NETWORK_TIMEOUT_MS
) {
  return callRuntimeResult<TResult>(`plane.${method}`, params, timeoutMs)
}

/** The web client is always remote: every Plane call runs on the paired runtime. */
export function createWebPlaneApi(): PreloadApi['plane'] {
  return {
    connect: (args) => planeCall('connect', args),
    status: () => planeCall('status', undefined, PLANE_SETTINGS_TIMEOUT_MS),
    disconnect: () => planeCall('disconnect', undefined, PLANE_SETTINGS_TIMEOUT_MS),
    setProjectScope: (args) => planeCall('setProjectScope', args, PLANE_SETTINGS_TIMEOUT_MS),
    listProjects: (args) => planeCall('listProjects', args),
    // Why the chunk reader: a 500-item list can exceed the 1 MiB socket frame. The wire shape
    // is the one Jira payloads already use.
    listWorkItems: (args) =>
      readRuntimeJiraPayload(
        { kind: 'environment', environmentId: requireActiveEnvironment().id },
        'plane.listWorkItems',
        args
      ),
    getWorkItem: (args) => planeCall('getWorkItem', args),
    lookupWorkItem: (args) => planeCall('lookupWorkItem', args),
    listStates: (args) => planeCall('listStates', args),
    listMembers: (args) => planeCall('listMembers', args),
    listComments: (args) => planeCall('listComments', args),
    updateState: (args) => planeCall('updateState', args),
    addComment: (args) => planeCall('addComment', args)
  }
}
