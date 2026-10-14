import { isPlaneCursor } from '../../shared/plane-ids'
import { PlaneApiError } from './plane-api-error'

export const PLANE_PER_PAGE = 100

export type PlanePage = {
  results: unknown[]
  /** Only set when the server says another page exists. */
  nextCursor: string | null
  totalResults: number | null
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Accepts a bare array or Plane's cursor envelope; anything else is an invalid response. */
export function parsePlanePage(body: unknown): PlanePage {
  if (Array.isArray(body)) {
    return { results: body, nextCursor: null, totalResults: body.length }
  }
  if (!isRecord(body) || !Array.isArray(body.results)) {
    throw new PlaneApiError('invalid_response')
  }
  const hasNext = body.next_page_results !== false && isPlaneCursor(body.next_cursor)
  return {
    results: body.results,
    nextCursor: hasNext && typeof body.next_cursor === 'string' ? body.next_cursor : null,
    totalResults:
      typeof body.total_results === 'number' && Number.isFinite(body.total_results)
        ? body.total_results
        : null
  }
}

export function planePageQuery(cursor?: string, perPage = PLANE_PER_PAGE): Record<string, string> {
  return { per_page: String(perPage), ...(cursor ? { cursor } : {}) }
}

export type PlanePagesResult = {
  items: unknown[]
  /** Where "load more" resumes, or null when the listing is complete. */
  nextCursor: string | null
  /** True when `maxItems` cut the listing short. */
  capped: boolean
}

export async function collectPlanePages(
  fetchPage: (cursor: string | undefined) => Promise<unknown>,
  limits: { maxPages: number; maxItems: number; startCursor?: string }
): Promise<PlanePagesResult> {
  const items: unknown[] = []
  const seen = new Set<string>()
  let cursor = limits.startCursor
  for (let page = 0; page < limits.maxPages; page += 1) {
    const parsed = parsePlanePage(await fetchPage(cursor))
    const room = limits.maxItems - items.length
    items.push(...parsed.results.slice(0, room))
    if (parsed.results.length > room) {
      return { items, nextCursor: null, capped: true }
    }
    // Why the seen-set: a server that repeats a cursor would otherwise loop to maxPages.
    if (!parsed.nextCursor || seen.has(parsed.nextCursor)) {
      return { items, nextCursor: null, capped: false }
    }
    seen.add(parsed.nextCursor)
    cursor = parsed.nextCursor
    if (items.length >= limits.maxItems) {
      return { items, nextCursor: cursor, capped: true }
    }
  }
  return { items, nextCursor: cursor ?? null, capped: false }
}
