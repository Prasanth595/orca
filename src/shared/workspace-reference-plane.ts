import { parsePlaneWorkItemUrl } from './plane-url'
import type { WorkspaceAttachment } from './worktree/types'

/**
 * Parses a Plane work item URL into a reference, rewriting `url` to one canonical route so
 * `/work-items/` and `/issues/` links to the same item share an identity. Plane is only tried
 * on `app.plane.so` or with an explicit hint: a self-hosted `/browse/KEY-N` path is
 * indistinguishable from Jira's.
 */
export function parsePlaneReferenceRoute(url: URL): WorkspaceAttachment | null {
  const ref = parsePlaneWorkItemUrl(url.href)
  if (!ref) {
    return null
  }
  const lowerPath = url.pathname.toLowerCase()
  const marker =
    ref.kind === 'id' ? `/${ref.workspaceSlug}/projects/` : `/${ref.workspaceSlug}/browse/`
  const prefixEnd = lowerPath.indexOf(marker)
  const prefix = prefixEnd === -1 ? '' : url.pathname.slice(0, prefixEnd)
  if (ref.kind === 'identifier') {
    url.pathname = `${prefix}/${ref.workspaceSlug}/browse/${ref.identifier}`
    return {
      provider: 'plane',
      type: 'issue',
      number: 0,
      identifier: ref.identifier,
      url: url.href
    }
  }
  url.pathname = `${prefix}/${ref.workspaceSlug}/projects/${ref.projectId}/issues/${ref.workItemId}`
  return { provider: 'plane', type: 'issue', number: 0, url: url.href }
}
