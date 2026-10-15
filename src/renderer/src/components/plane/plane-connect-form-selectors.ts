import type { PlaneConnectArgs } from '../../../../preload/api/plane-api'
import type { PlaneProjectScope } from '../../../../shared/plane-types'
import {
  normalizePlaneConnectionUrls,
  type PlaneConnectionUrls
} from '../../../../shared/plane-url'
import type { PlaneConnectFormState, PlaneScopeDraft } from './plane-connect-form-model'
import {
  addPlaneWorkspaceChips,
  parsePlaneSlugEntries,
  planeChipsToConnect
} from './plane-workspace-chips'

// Read-only views of the connect form state, kept apart from the reducer that changes it.

export function getPlaneConnectUrls(state: PlaneConnectFormState): PlaneConnectionUrls | null {
  if (state.hostKind === 'cloud') {
    return normalizePlaneConnectionUrls({ hostKind: 'cloud' })
  }
  if (state.hostKind === 'self-hosted' && state.serverUrl.trim()) {
    return normalizePlaneConnectionUrls({
      hostKind: 'self-hosted',
      serverUrl: state.serverUrl,
      ...(state.advancedOpen ? { apiBaseUrl: state.apiBaseUrl } : {})
    })
  }
  return null
}

/** Plain http to a non-loopback host: the user must agree before the token is sent. */
export function needsInsecureHttpConsent(state: PlaneConnectFormState): boolean {
  const urls = getPlaneConnectUrls(state)
  return state.reuseFrom === null && urls?.ok === true && urls.insecure
}

/** A Plane Cloud URL typed into the self-hosted form. */
export function isCloudUrlInSelfHostedForm(state: PlaneConnectFormState): boolean {
  const urls = getPlaneConnectUrls(state)
  return state.hostKind === 'self-hosted' && urls?.ok === true && urls.hostKind === 'cloud'
}

/** Slugs the next Connect would verify, including a typed one not yet turned into a chip. */
export function getPlaneSlugsToConnect(state: PlaneConnectFormState): string[] {
  const draft = parsePlaneSlugEntries(state.slugDraft).slugs
  return planeChipsToConnect(addPlaneWorkspaceChips(state.chips, draft)).map((chip) => chip.slug)
}

export function canSubmitPlaneCredentials(state: PlaneConnectFormState): boolean {
  if (state.submitting || getPlaneSlugsToConnect(state).length === 0) {
    return false
  }
  if (state.reuseFrom) {
    return true
  }
  const urls = getPlaneConnectUrls(state)
  return (
    urls?.ok === true &&
    /^\S+$/.test(state.apiToken.trim()) &&
    (!urls.insecure || state.insecureHttpAcknowledged)
  )
}

/** Connect params for one workspace slug, or null when the form cannot send them yet. */
export function toPlaneConnectArgs(
  state: PlaneConnectFormState,
  workspaceSlug: string
): PlaneConnectArgs | null {
  if (state.reuseFrom) {
    return { reuseTokenFromConnectionId: state.reuseFrom.connectionId, workspaceSlug }
  }
  const urls = getPlaneConnectUrls(state)
  if (!state.hostKind || urls?.ok !== true || !/^\S+$/.test(state.apiToken.trim())) {
    return null
  }
  const base = { workspaceSlug, apiToken: state.apiToken.trim() }
  if (state.hostKind === 'cloud') {
    return { hostKind: 'cloud', ...base }
  }
  const apiBaseUrl = state.advancedOpen ? state.apiBaseUrl.trim() : ''
  return {
    hostKind: 'self-hosted',
    serverUrl: state.serverUrl.trim(),
    ...(apiBaseUrl ? { apiBaseUrl } : {}),
    ...base,
    ...(needsInsecureHttpConsent(state) ? { insecureHttpAcknowledged: true } : {})
  }
}

/** Where Plane lists personal access tokens, for the first workspace once the URL is known. */
export function getPlaneTokenSettingsUrl(state: PlaneConnectFormState): string | null {
  const urls = getPlaneConnectUrls(state)
  if (urls?.ok !== true) {
    return null
  }
  const slug = state.chips[0]?.slug ?? parsePlaneSlugEntries(state.slugDraft).slugs[0]
  return slug
    ? `${urls.webBaseUrl}/${encodeURIComponent(slug)}/settings/account/api-tokens`
    : urls.webBaseUrl
}

export function getPlaneScopeToSave(draft: PlaneScopeDraft): PlaneProjectScope | null {
  if (!draft) {
    return null
  }
  return draft.mode === 'all' || draft.projectIds.length > 0 ? draft : null
}
