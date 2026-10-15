import { describe, expect, it } from 'vitest'
import {
  buildPlaneBrowseUrl,
  buildPlaneWorkItemUrl,
  normalizePlaneConnectionUrls,
  parsePlaneWorkItemUrl,
  PLANE_CLOUD_API_BASE_URL,
  PLANE_CLOUD_WEB_BASE_URL
} from './plane-url'

const PROJECT_ID = '0b5c7c4e-2f0a-4c1e-9d55-0d6c1a2b3c4d'
const ITEM_ID = '9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d'

function selfHosted(serverUrl: string, apiBaseUrl?: string) {
  return normalizePlaneConnectionUrls({ hostKind: 'self-hosted', serverUrl, apiBaseUrl })
}

describe('normalizePlaneConnectionUrls', () => {
  it('returns the fixed Plane Cloud bases', () => {
    expect(normalizePlaneConnectionUrls({ hostKind: 'cloud' })).toEqual({
      ok: true,
      hostKind: 'cloud',
      apiBaseUrl: PLANE_CLOUD_API_BASE_URL,
      webBaseUrl: PLANE_CLOUD_WEB_BASE_URL,
      insecure: false
    })
  })

  it('normalizes a bare https host', () => {
    expect(selfHosted('  plane.example.test/ ')).toEqual({
      ok: true,
      hostKind: 'self-hosted',
      apiBaseUrl: 'https://plane.example.test',
      webBaseUrl: 'https://plane.example.test',
      insecure: false
    })
  })

  it('keeps a path prefix, port and private address and flags plain http', () => {
    expect(selfHosted('http://192.168.1.10:8080/plane/')).toEqual({
      ok: true,
      hostKind: 'self-hosted',
      apiBaseUrl: 'http://192.168.1.10:8080/plane',
      webBaseUrl: 'http://192.168.1.10:8080/plane',
      insecure: true
    })
  })

  it('does not flag plain http to loopback', () => {
    expect(selfHosted('http://localhost:3000')).toMatchObject({
      ok: true,
      apiBaseUrl: 'http://localhost:3000',
      insecure: false
    })
  })

  it('keeps IPv6 hosts with a port', () => {
    expect(selfHosted('http://[fd00::12]:8443/plane')).toMatchObject({
      ok: true,
      apiBaseUrl: 'http://[fd00::12]:8443/plane',
      insecure: true
    })
    expect(selfHosted('[::1]:8080')).toMatchObject({ ok: true, apiBaseUrl: 'https://[::1]:8080' })
  })

  it.each([
    ['https://plane.example.test/api/v1/', 'https://plane.example.test', undefined],
    ['https://plane.example.test/api', 'https://plane.example.test', undefined],
    [
      'https://plane.example.test/plane/api/v1/workspaces/acme/projects/',
      'https://plane.example.test/plane',
      'acme'
    ]
  ])('strips the API path from %s', (input, base, slug) => {
    const result = selfHosted(input)
    expect(result).toMatchObject({ ok: true, apiBaseUrl: base, webBaseUrl: base })
    expect(result.ok ? result.slugSuggestion : null).toBe(slug)
  })

  it.each([
    ['https://plane.example.test/acme/projects/', 'https://plane.example.test', 'acme'],
    [
      'https://plane.example.test/plane/acme/browse/WEB-12/',
      'https://plane.example.test/plane',
      'acme'
    ],
    [
      'https://plane.example.test/Acme-Team/settings?tab=x#y',
      'https://plane.example.test',
      'acme-team'
    ]
  ])('takes the slug out of browser URL %s', (input, base, slug) => {
    expect(selfHosted(input)).toMatchObject({ ok: true, webBaseUrl: base, slugSuggestion: slug })
  })

  it.each([
    'https://plane.example.test/god-mode/',
    'https://plane.example.test/sign-in?next=/acme',
    'https://plane.example.test/profile/projects/',
    'https://plane.example.test/create-workspace'
  ])('never treats a reserved route as a slug: %s', (input) => {
    const result = selfHosted(input)
    expect(result).toMatchObject({ ok: true, webBaseUrl: 'https://plane.example.test' })
    expect(result.ok && result.slugSuggestion).toBeUndefined()
  })

  it.each(['https://app.plane.so/acme/projects/', 'api.plane.so/api/v1/workspaces/acme/'])(
    'switches %s to the Cloud bases',
    (input) => {
      expect(selfHosted(input)).toEqual({
        ok: true,
        hostKind: 'cloud',
        apiBaseUrl: PLANE_CLOUD_API_BASE_URL,
        webBaseUrl: PLANE_CLOUD_WEB_BASE_URL,
        insecure: false,
        slugSuggestion: 'acme'
      })
    }
  )

  it.each([
    ['', 'empty'],
    ['ftp://plane.example.test', 'unsupported_protocol'],
    ['javascript:alert(1)', 'unsupported_protocol'],
    ['https://user:pass@plane.example.test', 'credentials_in_url'],
    ['user:pass@plane.example.test', 'credentials_in_url'],
    ['https://exa mple', 'invalid_url']
  ])('rejects %j as %s', (input, error) => {
    expect(selfHosted(input)).toEqual({ ok: false, field: 'serverUrl', error })
  })

  it('uses a separate API base URL and judges insecurity by it', () => {
    expect(selfHosted('https://plane.example.test', 'http://10.0.0.5:8000/api/v1')).toEqual({
      ok: true,
      hostKind: 'self-hosted',
      apiBaseUrl: 'http://10.0.0.5:8000',
      webBaseUrl: 'https://plane.example.test',
      insecure: true
    })
    expect(selfHosted('https://plane.example.test', 'ftp://x')).toEqual({
      ok: false,
      field: 'apiBaseUrl',
      error: 'unsupported_protocol'
    })
  })
})

describe.each([
  { name: 'cloud', webBaseUrl: PLANE_CLOUD_WEB_BASE_URL },
  { name: 'self-hosted with a prefix', webBaseUrl: 'https://plane.example.test/plane' }
])('Plane links on $name', ({ webBaseUrl }) => {
  const base = { webBaseUrl, workspaceSlug: 'acme' }

  it('builds and parses the project work item URL', () => {
    const url = buildPlaneWorkItemUrl(base, { projectId: PROJECT_ID, id: ITEM_ID })
    expect(url).toBe(`${webBaseUrl}/acme/projects/${PROJECT_ID}/issues/${ITEM_ID}`)
    const expected = {
      kind: 'id',
      workspaceSlug: 'acme',
      projectId: PROJECT_ID,
      workItemId: ITEM_ID
    }
    expect(parsePlaneWorkItemUrl(url, webBaseUrl)).toEqual(expected)
    expect(parsePlaneWorkItemUrl(url)).toEqual(expected)
  })

  it('builds and parses the browse URL', () => {
    const url = buildPlaneBrowseUrl(base, 'WEB-12')
    expect(url).toBe(`${webBaseUrl}/acme/browse/WEB-12/`)
    expect(parsePlaneWorkItemUrl(url, webBaseUrl)).toEqual({
      kind: 'identifier',
      workspaceSlug: 'acme',
      identifier: 'WEB-12'
    })
  })

  it('accepts the work-items route, uppercase ids and a side peek', () => {
    const upper = `${webBaseUrl}/acme/projects/${PROJECT_ID.toUpperCase()}/work-items/${ITEM_ID.toUpperCase()}`
    expect(parsePlaneWorkItemUrl(upper, webBaseUrl)).toMatchObject({
      projectId: PROJECT_ID,
      workItemId: ITEM_ID
    })
    const peek = `${webBaseUrl}/acme/projects/${PROJECT_ID}/issues?peekIssue=${ITEM_ID}`
    expect(parsePlaneWorkItemUrl(peek, webBaseUrl)).toMatchObject({ workItemId: ITEM_ID })
  })

  it('rejects other origins, bad ids and unrelated paths', () => {
    expect(parsePlaneWorkItemUrl(`https://elsewhere.test/acme/browse/WEB-12/`, webBaseUrl)).toBe(
      null
    )
    expect(parsePlaneWorkItemUrl(`${webBaseUrl}/acme/projects/nope/issues/${ITEM_ID}`)).toBe(null)
    expect(parsePlaneWorkItemUrl(`${webBaseUrl}/acme/browse/WEB/`)).toBe(null)
    expect(parsePlaneWorkItemUrl(`${webBaseUrl}/god-mode/browse/WEB-1/`)).toBe(null)
    expect(parsePlaneWorkItemUrl('not a url', webBaseUrl)).toBe(null)
  })
})
