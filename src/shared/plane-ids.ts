// Why validate ids that came from Plane: they are spliced into API paths on the host, so a
// crafted id from a client must never reach a different endpoint. Callers still encode them.

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
// Plane slugs are lowercase url-safe names; the length cap matches its 48-char limit.
const WORKSPACE_SLUG_PATTERN = /^[a-z0-9][a-z0-9_-]{0,47}$/
// Plane accepts uppercase letters beyond ASCII (e.g. Turkish) in project identifiers.
const PROJECT_IDENTIFIER_PATTERN = /^[\p{Lu}0-9]{1,12}$/u
const WORK_ITEM_IDENTIFIER_PATTERN = /^([\p{Lu}0-9]{1,12})-(\d{1,9})$/u
// Plane's cursor is `{per_page}:{page}:{offset}`.
const CURSOR_PATTERN = /^\d{1,4}:\d{1,9}:\d{1,9}$/
// base64url of a sha256 digest, truncated.
const CONNECTION_ID_PATTERN = /^[A-Za-z0-9_-]{24}$/

export function isPlaneUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID_PATTERN.test(value)
}

export function normalizePlaneWorkspaceSlug(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null
  }
  const slug = value.trim().toLowerCase()
  return WORKSPACE_SLUG_PATTERN.test(slug) ? slug : null
}

export function isPlaneProjectIdentifier(value: unknown): value is string {
  return typeof value === 'string' && PROJECT_IDENTIFIER_PATTERN.test(value)
}

export type PlaneWorkItemIdentifier = {
  identifier: string
  projectIdentifier: string
  sequenceId: number
}

/** Accepts `web-12` as well as `WEB-12`; Plane shows identifiers uppercase. */
export function parsePlaneWorkItemIdentifier(value: unknown): PlaneWorkItemIdentifier | null {
  if (typeof value !== 'string') {
    return null
  }
  const match = WORK_ITEM_IDENTIFIER_PATTERN.exec(value.trim().toUpperCase())
  if (!match) {
    return null
  }
  const sequenceId = Number(match[2])
  if (!Number.isSafeInteger(sequenceId) || sequenceId < 1) {
    return null
  }
  const projectIdentifier = match[1]
  return { identifier: `${projectIdentifier}-${sequenceId}`, projectIdentifier, sequenceId }
}

export function isPlaneCursor(value: unknown): value is string {
  return typeof value === 'string' && CURSOR_PATTERN.test(value)
}

export function isPlaneConnectionId(value: unknown): value is string {
  return typeof value === 'string' && CONNECTION_ID_PATTERN.test(value)
}
