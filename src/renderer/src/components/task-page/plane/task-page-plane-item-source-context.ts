import type { PlaneConnection, PlaneWorkItem } from '../../../../../shared/plane-types'
import {
  normalizeTaskSourceContext,
  type TaskSourceContext
} from '../../../../../shared/task-source-context'

/**
 * The Tasks page source context, narrowed to the item's Plane connection and project.
 * Why the spread: `projectId` stays the Orca project; the Plane project only lives in the identity.
 */
export function bindTaskPagePlaneItemSourceContext(args: {
  item: Pick<PlaneWorkItem, 'connectionId' | 'projectId'>
  connection: PlaneConnection | null
  sourceContext: TaskSourceContext | null
}): TaskSourceContext | null {
  const { item, connection, sourceContext } = args
  if (sourceContext?.provider !== 'plane' || !connection || connection.id !== item.connectionId) {
    return null
  }
  return normalizeTaskSourceContext({
    ...sourceContext,
    providerIdentity: {
      provider: 'plane',
      connectionId: connection.id,
      apiBaseUrl: connection.apiBaseUrl,
      webBaseUrl: connection.webBaseUrl,
      workspaceSlug: connection.workspaceSlug,
      projectId: item.projectId
    },
    accountLabel:
      connection.viewer.email || connection.viewer.displayName || connection.workspaceSlug
  })
}
