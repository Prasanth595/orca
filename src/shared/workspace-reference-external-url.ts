import { buildPlaneBrowseUrl } from './plane-url'
import type { WorkspaceAttachment } from './worktree/types'

export function getWorkspaceReferenceIdentifier(item: WorkspaceAttachment): string | undefined {
  return item.identifier ?? item.linearIdentifier ?? item.jiraIdentifier
}

export function getWorkspaceReferenceExternalUrl(item: WorkspaceAttachment): string | undefined {
  if (item.url) {
    return item.url
  }
  const identity = item.taskSourceContext?.providerIdentity
  const identifier = getWorkspaceReferenceIdentifier(item)
  if (item.provider === 'linear' && item.linearOrganizationUrlKey && identifier) {
    return `https://linear.app/${encodeURIComponent(item.linearOrganizationUrlKey)}/issue/${encodeURIComponent(identifier)}`
  }
  if (!identity || identity.provider !== item.provider) {
    return undefined
  }
  switch (identity.provider) {
    case 'github':
      return `https://${identity.host ?? 'github.com'}/${identity.owner}/${identity.repo}/${item.type === 'pr' ? 'pull' : 'issues'}/${item.number}`
    case 'gitlab':
      return identity.webUrl
        ? `${identity.webUrl.replace(/\/+$/, '')}/-/${item.type === 'mr' ? 'merge_requests' : 'issues'}/${item.number}`
        : undefined
    case 'jira':
      return identity.siteUrl && identifier
        ? `${identity.siteUrl.replace(/\/+$/, '')}/browse/${identifier}`
        : undefined
    case 'plane':
      return identity.webBaseUrl && identity.workspaceSlug && identifier
        ? buildPlaneBrowseUrl(
            { webBaseUrl: identity.webBaseUrl, workspaceSlug: identity.workspaceSlug },
            identifier
          )
        : undefined
    case 'linear':
      return undefined
  }
}

export function getWorkspaceAttachmentUrlScope(item: WorkspaceAttachment): string {
  if (!item.url) {
    return ''
  }
  try {
    const url = new URL(item.url)
    return (
      url.origin +
      url.pathname
        .replace(
          /\/(?:pull|pulls|issues|merge_requests|pull-requests|pullrequest|browse|issue)\/[^/]+(?:\/.*)?$/,
          ''
        )
        .replace(/\/-$/, '')
    )
  } catch {
    return ''
  }
}
