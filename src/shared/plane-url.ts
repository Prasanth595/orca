import type { PlaneHostKind, PlaneUrlErrorKind } from './plane-types'
import { isPlaneUuid, normalizePlaneWorkspaceSlug, parsePlaneWorkItemIdentifier } from './plane-ids'
import { isInsecureRemoteWebOrigin } from './web-origin-security'

export const PLANE_CLOUD_API_BASE_URL = 'https://api.plane.so'
export const PLANE_CLOUD_WEB_BASE_URL = 'https://app.plane.so'
const PLANE_CLOUD_HOSTS = new Set(['api.plane.so', 'app.plane.so'])

// Top-level web routes Plane reserves, so none of them can be a workspace slug.
const RESERVED_ROOT_ROUTES = new Set([
  'god-mode',
  'profile',
  'sign-in',
  'sign-up',
  'accounts',
  'auth',
  'create-workspace',
  'invitations',
  'workspace-invitations',
  'onboarding',
  'spaces',
  'api'
])
// Routes that only exist under `/{slug}/`, so the segment before one is the slug.
const WORKSPACE_ROUTES = new Set([
  'projects',
  'browse',
  'settings',
  'analytics',
  'active-cycles',
  'notifications',
  'drafts',
  'pages',
  'stickies',
  'workspace-views'
])
const WORK_ITEM_ROUTES = new Set(['issues', 'work-items'])
// A scheme is letters then `:`; `host:8080` is a port, not a scheme.
const SCHEME_PATTERN = /^[a-z][a-z0-9+.-]*:(?!\d)/i

export type PlaneConnectionUrlInput =
  | { hostKind: 'cloud' }
  | { hostKind: 'self-hosted'; serverUrl: string; apiBaseUrl?: string }

export type { PlaneUrlErrorKind }

export type PlaneConnectionUrls =
  | {
      ok: true
      hostKind: PlaneHostKind
      apiBaseUrl: string
      webBaseUrl: string
      /** Plain http to a non-loopback host: the token would cross the network unencrypted. */
      insecure: boolean
      slugSuggestion?: string
    }
  | { ok: false; field: 'serverUrl' | 'apiBaseUrl'; error: PlaneUrlErrorKind }

type ParsedBase = { url: URL; base: string; slugSuggestion?: string }

export function isPlaneCloudHost(hostname: string): boolean {
  return PLANE_CLOUD_HOSTS.has(hostname.toLowerCase())
}

function parseHttpUrl(raw: string): URL | PlaneUrlErrorKind {
  const trimmed = raw.trim()
  if (!trimmed) {
    return 'empty'
  }
  const hasScheme = SCHEME_PATTERN.test(trimmed) && !/^[^/]*@/.test(trimmed.split('//')[0])
  let url: URL
  try {
    url = new URL(hasScheme ? trimmed : `https://${trimmed}`)
  } catch {
    return 'invalid_url'
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return 'unsupported_protocol'
  }
  if (url.username || url.password) {
    return 'credentials_in_url'
  }
  return url.hostname ? url : 'invalid_url'
}

function pathSegments(url: URL): string[] {
  return url.pathname.split('/').filter((segment) => segment.length > 0)
}

// Splits a pasted path into the install's path prefix and, for a browser or API URL, the slug.
function splitServerPath(segments: string[]): { prefix: string[]; slug?: string } {
  const lower = segments.map((segment) => segment.toLowerCase())
  const apiIndex = lower.indexOf('api')
  if (apiIndex !== -1) {
    const slug =
      lower[apiIndex + 1] === 'v1' && lower[apiIndex + 2] === 'workspaces'
        ? normalizePlaneWorkspaceSlug(segments[apiIndex + 3])
        : null
    return { prefix: segments.slice(0, apiIndex), ...(slug ? { slug } : {}) }
  }
  const routeIndex = lower.findIndex((segment, index) => index > 0 && WORKSPACE_ROUTES.has(segment))
  if (routeIndex !== -1) {
    const candidate = lower[routeIndex - 1]
    const slug = RESERVED_ROOT_ROUTES.has(candidate) ? null : normalizePlaneWorkspaceSlug(candidate)
    return { prefix: segments.slice(0, routeIndex - 1), ...(slug ? { slug } : {}) }
  }
  const reservedIndex = lower.findIndex((segment) => RESERVED_ROOT_ROUTES.has(segment))
  return { prefix: reservedIndex === -1 ? segments : segments.slice(0, reservedIndex) }
}

function toBase(url: URL, prefix: string[]): string {
  return `${url.protocol}//${url.host}${prefix.map((segment) => `/${segment}`).join('')}`
}

function parseServerBase(raw: string): ParsedBase | PlaneUrlErrorKind {
  const url = parseHttpUrl(raw)
  if (typeof url === 'string') {
    return url
  }
  const { prefix, slug } = splitServerPath(pathSegments(url))
  return { url, base: toBase(url, prefix), ...(slug ? { slugSuggestion: slug } : {}) }
}

function parseApiBase(raw: string): ParsedBase | PlaneUrlErrorKind {
  const url = parseHttpUrl(raw)
  if (typeof url === 'string') {
    return url
  }
  const segments = pathSegments(url)
  const apiIndex = segments.findIndex((segment) => segment.toLowerCase() === 'api')
  return { url, base: toBase(url, apiIndex === -1 ? segments : segments.slice(0, apiIndex)) }
}

function cloudUrls(slugSuggestion?: string): PlaneConnectionUrls {
  return {
    ok: true,
    hostKind: 'cloud',
    apiBaseUrl: PLANE_CLOUD_API_BASE_URL,
    webBaseUrl: PLANE_CLOUD_WEB_BASE_URL,
    insecure: false,
    ...(slugSuggestion ? { slugSuggestion } : {})
  }
}

/** Never probes the network: the URLs come only from what the user typed. */
export function normalizePlaneConnectionUrls(input: PlaneConnectionUrlInput): PlaneConnectionUrls {
  if (input.hostKind === 'cloud') {
    return cloudUrls()
  }
  const server = parseServerBase(input.serverUrl)
  if (typeof server === 'string') {
    return { ok: false, field: 'serverUrl', error: server }
  }
  // Why: a Cloud URL pasted into the self-hosted form means the user wants Plane Cloud.
  if (isPlaneCloudHost(server.url.hostname)) {
    return cloudUrls(server.slugSuggestion)
  }
  let apiBaseUrl = server.base
  if (input.apiBaseUrl?.trim()) {
    const api = parseApiBase(input.apiBaseUrl)
    if (typeof api === 'string') {
      return { ok: false, field: 'apiBaseUrl', error: api }
    }
    apiBaseUrl = api.base
  }
  return {
    ok: true,
    hostKind: 'self-hosted',
    apiBaseUrl,
    webBaseUrl: server.base,
    insecure: isInsecureRemoteWebOrigin(apiBaseUrl),
    ...(server.slugSuggestion ? { slugSuggestion: server.slugSuggestion } : {})
  }
}

export type PlaneLinkBase = { webBaseUrl: string; workspaceSlug: string }

export function buildPlaneWorkItemUrl(
  base: PlaneLinkBase,
  item: { projectId: string; id: string }
): string {
  return `${base.webBaseUrl}/${encodeURIComponent(base.workspaceSlug)}/projects/${encodeURIComponent(item.projectId)}/issues/${encodeURIComponent(item.id)}`
}

export function buildPlaneBrowseUrl(base: PlaneLinkBase, identifier: string): string {
  return `${base.webBaseUrl}/${encodeURIComponent(base.workspaceSlug)}/browse/${encodeURIComponent(identifier)}/`
}

export type PlaneWorkItemUrlRef =
  | { kind: 'id'; workspaceSlug: string; projectId: string; workItemId: string }
  | { kind: 'identifier'; workspaceSlug: string; identifier: string }

function stripBasePath(url: URL, webBaseUrl: string | undefined): string[] | null {
  if (!webBaseUrl) {
    return pathSegments(url)
  }
  let base: URL
  try {
    base = new URL(webBaseUrl)
  } catch {
    return null
  }
  if (base.origin !== url.origin) {
    return null
  }
  const prefix = pathSegments(base)
  const segments = pathSegments(url)
  const hasPrefix = prefix.every((segment, index) => segments[index] === segment)
  return hasPrefix ? segments.slice(prefix.length) : segments
}

function matchWorkItemAt(segments: string[], index: number, url: URL): PlaneWorkItemUrlRef | null {
  const workspaceSlug = RESERVED_ROOT_ROUTES.has(segments[index].toLowerCase())
    ? null
    : normalizePlaneWorkspaceSlug(segments[index])
  if (!workspaceSlug) {
    return null
  }
  const [route, projectId, itemRoute, workItemId] = segments.slice(index + 1, index + 5)
  if (route === 'browse') {
    const parsed = parsePlaneWorkItemIdentifier(projectId)
    return parsed ? { kind: 'identifier', workspaceSlug, identifier: parsed.identifier } : null
  }
  if (route !== 'projects' || !isPlaneUuid(projectId) || !WORK_ITEM_ROUTES.has(itemRoute)) {
    return null
  }
  // A list URL with an open side peek names the item in the query.
  const id = workItemId ?? url.searchParams.get('peekIssue')
  return isPlaneUuid(id)
    ? {
        kind: 'id',
        workspaceSlug,
        projectId: projectId.toLowerCase(),
        workItemId: id.toLowerCase()
      }
    : null
}

/**
 * Accepts `/{slug}/projects/{uuid}/(issues|work-items)/{uuid}` and `/{slug}/browse/{IDENT-N}/`.
 * With `webBaseUrl`, only URLs on that origin match.
 */
export function parsePlaneWorkItemUrl(
  raw: string,
  webBaseUrl?: string
): PlaneWorkItemUrlRef | null {
  const url = parseHttpUrl(raw)
  if (typeof url === 'string') {
    return null
  }
  const segments = stripBasePath(url, webBaseUrl)
  if (!segments) {
    return null
  }
  for (let index = 0; index < segments.length - 1; index += 1) {
    const match = matchWorkItemAt(segments, index, url)
    if (match) {
      return match
    }
  }
  return null
}
