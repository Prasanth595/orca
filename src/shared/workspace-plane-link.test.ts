import { describe, expect, it } from 'vitest'
import { buildPlaneWorkItemUrl, buildPlaneBrowseUrl, PLANE_CLOUD_WEB_BASE_URL } from './plane-url'
import {
  buildPlaneWorkspaceSource,
  buildWorkspaceSourceSelection,
  getWorkspaceSourceName,
  getWorkspaceSourceProvider
} from './new-workspace/workspace-source'
import type { TaskSourceContext } from './task-source-context'
import { getWorkspaceAttachmentKey } from './workspace-attachment-normalization'
import { areWorkspaceLinkedItemsEqual, normalizeWorkspaceLinkedItem } from './workspace-linked-item'
import { isWorkspaceLinkedItemSourceContextMatch } from './workspace-linked-item-source-context'
import {
  getWorkspaceReferenceIdentity,
  parseWorkspaceReferenceUrl
} from './workspace-reference-identity'

const PROJECT = '0b5c7c4e-2f0a-4c1e-9d55-0d6c1a2b3c4d'
const ITEM = '9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d'
const OTHER_ITEM = '1a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d'

describe.each([
  { name: 'Plane Cloud', webBaseUrl: PLANE_CLOUD_WEB_BASE_URL },
  { name: 'self-hosted with a prefix', webBaseUrl: 'https://plane.example.test/plane' }
])('Plane workspace links on $name', ({ webBaseUrl }) => {
  const base = { webBaseUrl, workspaceSlug: 'acme' }
  const url = buildPlaneWorkItemUrl(base, { projectId: PROJECT, id: ITEM })
  const source = buildPlaneWorkspaceSource({ identifier: 'WEB-12', name: 'Fix login', url })
  const context: TaskSourceContext = {
    kind: 'task-source',
    provider: 'plane',
    projectId: 'orca-project',
    hostId: 'local',
    providerIdentity: {
      provider: 'plane',
      connectionId: 'abcdefghijklmnopqrstuvwx',
      apiBaseUrl: webBaseUrl,
      webBaseUrl,
      workspaceSlug: 'acme',
      projectId: PROJECT
    }
  }

  it('is a plane source with an identifier label, never a GitHub issue', () => {
    expect(getWorkspaceSourceProvider(source)).toBe('plane')
    expect(buildWorkspaceSourceSelection({ linkedWorkItem: source })).toEqual({
      kind: 'plane',
      label: 'WEB-12 Fix login',
      url
    })
    expect(getWorkspaceSourceName(source).seedName).toBe('web-12-fix-login')
  })

  it('keeps an explicit plane provider on a /browse/ URL that would read as Jira', () => {
    const browse = { ...source, url: buildPlaneBrowseUrl(base, 'WEB-12') }
    expect(getWorkspaceSourceProvider(browse)).toBe('plane')
    expect(buildWorkspaceSourceSelection({ linkedWorkItem: browse })?.kind).toBe('plane')
    expect(getWorkspaceSourceProvider({ ...browse, provider: undefined })).toBe('jira')
  })

  it('round-trips the identifier and keeps WEB-12 and API-12 apart', () => {
    expect(normalizeWorkspaceLinkedItem(source)).toEqual(source)
    const api = buildPlaneWorkspaceSource({
      identifier: 'API-12',
      name: 'Fix login',
      url: buildPlaneWorkItemUrl(base, { projectId: PROJECT, id: OTHER_ITEM })
    })
    expect(areWorkspaceLinkedItemsEqual(source, api)).toBe(false)
    expect(getWorkspaceAttachmentKey(source)).not.toBe(getWorkspaceAttachmentKey(api))
    const sameNumberNoUrl = { ...api, url: source.url }
    expect(getWorkspaceAttachmentKey(source)).not.toBe(getWorkspaceAttachmentKey(sameNumberNoUrl))
  })

  it('matches only a source context for the same workspace and project', () => {
    expect(isWorkspaceLinkedItemSourceContextMatch(source, context)).toBe(true)
    const identity = context.providerIdentity
    if (identity?.provider !== 'plane') {
      throw new Error('fixture')
    }
    const other = (patch: Partial<typeof identity>): TaskSourceContext => ({
      ...context,
      providerIdentity: { ...identity, ...patch }
    })
    expect(isWorkspaceLinkedItemSourceContextMatch(source, other({ workspaceSlug: 'beta' }))).toBe(
      false
    )
    expect(
      isWorkspaceLinkedItemSourceContextMatch(
        source,
        other({ webBaseUrl: 'https://elsewhere.test' })
      )
    ).toBe(false)
    expect(isWorkspaceLinkedItemSourceContextMatch(source, other({ projectId: OTHER_ITEM }))).toBe(
      false
    )
    expect(isWorkspaceLinkedItemSourceContextMatch(source, other({ webBaseUrl: null }))).toBe(false)
    expect(
      isWorkspaceLinkedItemSourceContextMatch({ ...source, identifier: undefined }, context)
    ).toBe(false)
  })

  it('parses the link as a plane reference only with a hint or on Plane Cloud', () => {
    const hinted = parseWorkspaceReferenceUrl(url, 'plane')
    expect(hinted).toEqual({ provider: 'plane', type: 'issue', number: 0, url })
    const workItemsRoute = url.replace('/issues/', '/work-items/')
    expect(getWorkspaceReferenceIdentity(parseWorkspaceReferenceUrl(workItemsRoute, 'plane'))).toBe(
      getWorkspaceReferenceIdentity(hinted)
    )
    expect(parseWorkspaceReferenceUrl(`${webBaseUrl}/acme/browse/WEB-12/`, 'plane')).toMatchObject({
      provider: 'plane',
      identifier: 'WEB-12'
    })
  })
})

describe('Plane reference hosts', () => {
  it('reads app.plane.so as plane without a hint', () => {
    expect(parseWorkspaceReferenceUrl('https://app.plane.so/acme/browse/WEB-12/')).toMatchObject({
      provider: 'plane',
      identifier: 'WEB-12'
    })
  })

  it('keeps an unknown host /browse/X-1 as Jira', () => {
    expect(parseWorkspaceReferenceUrl('https://tracker.example.test/browse/X-1')).toMatchObject({
      provider: 'jira',
      identifier: 'X-1'
    })
  })

  it('refuses a plane hint for a URL that is not a Plane work item', () => {
    expect(() =>
      parseWorkspaceReferenceUrl('https://tracker.example.test/browse/X-1', 'plane')
    ).toThrow()
  })
})
