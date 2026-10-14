import { createHash } from 'node:crypto'

/** Stable 24-char id, also the token file name, however long the base URL is. */
export function getPlaneConnectionId(
  apiBaseUrl: string,
  workspaceSlug: string,
  viewerId: string
): string {
  return createHash('sha256')
    .update(`${apiBaseUrl}\n${workspaceSlug}\n${viewerId}`)
    .digest('base64url')
    .slice(0, 24)
}
