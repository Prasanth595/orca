import type { PlaneConnectionStatus } from '../../../shared/plane-types'
import { isPlaneCloudHost, parsePlaneWorkItemUrl } from '../../../shared/plane-url'
import { parseWorkspaceReferenceUrl } from '../../../shared/workspace-reference-identity'
import type { WorkspaceAttachment } from '../../../shared/worktree/types'

/**
 * 'plane' when a pasted URL belongs to the connected Plane workspace. A self-hosted
 * `/browse/KEY-N` link reads as Jira otherwise, so only a match on the connection's own web
 * base and slug may claim it.
 */
export function resolvePlaneReferenceHint(
  url: string,
  planeStatus: PlaneConnectionStatus | null | undefined
): 'plane' | undefined {
  if (!planeStatus?.connected) {
    return undefined
  }
  const { webBaseUrl, workspaceSlug } = planeStatus.connection
  const ref = parsePlaneWorkItemUrl(url, webBaseUrl)
  return ref?.workspaceSlug === workspaceSlug ? 'plane' : undefined
}

/** A pasted Plane work item URL as an attachment, or null when it is not one. */
export function parsePlaneAttachmentInput(
  value: string,
  planeStatus: PlaneConnectionStatus | null | undefined
): WorkspaceAttachment | null {
  let host = ''
  try {
    host = new URL(value).hostname
  } catch {
    return null
  }
  if (!isPlaneCloudHost(host) && !resolvePlaneReferenceHint(value, planeStatus)) {
    return null
  }
  try {
    const parsed = parseWorkspaceReferenceUrl(value, 'plane')
    return parsed.provider === 'plane' ? parsed : null
  } catch {
    return null
  }
}
