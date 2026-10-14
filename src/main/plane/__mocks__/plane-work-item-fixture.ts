import { z } from 'zod'
import { fixtureUuid, PLANE_FIXTURE_VIEWER, type PlaneApiFixture } from './plane-api-fixture'
import { planeJsonResponse } from './plane-http-module'

// Work item, state, member and comment routes on top of the fake Plane API.

const STATE_BASE = 1_000
const ITEM_BASE = 10_000
const COMMENT_BASE = 50_000

export function fixtureStateId(projectIndex: number, n: number): string {
  return fixtureUuid(STATE_BASE + projectIndex * 10 + n)
}

export function rawPlaneStates(projectIndex: number) {
  return [
    {
      id: fixtureStateId(projectIndex, 1),
      name: 'Todo',
      group: 'unstarted',
      color: '#aaa',
      sequence: 2
    },
    {
      id: fixtureStateId(projectIndex, 0),
      name: 'Backlog',
      group: 'backlog',
      color: '#bbb',
      sequence: 1
    },
    {
      id: fixtureStateId(projectIndex, 2),
      name: 'Done',
      group: 'completed',
      color: '#ccc',
      sequence: 3
    }
  ]
}

export const PLANE_FIXTURE_MEMBER = {
  id: PLANE_FIXTURE_VIEWER.id,
  display_name: 'ada',
  email: 'ada@example.test'
}

export function fixtureItemId(projectIndex: number, n: number): string {
  return fixtureUuid(ITEM_BASE + projectIndex * 1_000 + n)
}

/** An item as Plane returns it with `expand=state,assignees,labels`. */
export function rawPlaneWorkItem(
  projectIndex: number,
  n: number,
  extra: Record<string, unknown> = {}
) {
  return {
    id: fixtureItemId(projectIndex, n),
    project: fixtureUuid(projectIndex),
    sequence_id: n,
    name: `Item ${n} of project ${projectIndex}`,
    priority: 'high',
    state: rawPlaneStates(projectIndex)[0],
    assignees: [PLANE_FIXTURE_MEMBER],
    labels: [{ id: fixtureUuid(90_000 + n), name: 'bug', color: '#f00' }],
    created_at: '2026-01-01T00:00:00Z',
    updated_at: new Date(Date.UTC(2026, 1, 1) + projectIndex * 1_000 + n * 60_000).toISOString(),
    description_stripped: `Description of item ${n}`,
    description_html: `<p>Description of item ${n}</p>`,
    ...extra
  }
}

export type PlaneWorkItemFixture = {
  items: Map<string, Record<string, unknown>[]>
  comments: Map<string, Record<string, unknown>[]>
  members: unknown[]
  /** Serves the project member list instead of the workspace one. */
  workspaceMembersMissing: boolean
}

function page(results: unknown[], search: string) {
  const params = new URLSearchParams(search)
  const perPage = Number(params.get('per_page') ?? '100')
  const pageIndex = Number(params.get('cursor')?.split(':')[1] ?? '0')
  const start = pageIndex * perPage
  const more = start + perPage < results.length
  return {
    results: results.slice(start, start + perPage),
    next_cursor: more ? `${perPage}:${pageIndex + 1}:0` : null,
    next_page_results: more,
    total_results: results.length
  }
}

const JsonBody = z.record(z.string(), z.unknown())

function bodyField(body: unknown, key: string): string {
  const parsed = JsonBody.safeParse(body)
  const value = parsed.success ? parsed.data[key] : null
  return typeof value === 'string' ? value : ''
}

function projectIndexOf(projectId: string): number {
  return Number.parseInt(projectId.slice(-12), 16)
}

export function installPlaneWorkItemRoutes(fixture: PlaneApiFixture): PlaneWorkItemFixture {
  const state: PlaneWorkItemFixture = {
    items: new Map(),
    comments: new Map(),
    members: [{ id: fixtureUuid(70_000), role: 20, member: PLANE_FIXTURE_MEMBER }],
    workspaceMembersMissing: false
  }
  const ws = '/workspaces/acme'
  fixture.routes.push(({ method, path, search, body }) => {
    if (path === `${ws}/members/`) {
      return state.workspaceMembersMissing
        ? planeJsonResponse({ detail: 'Not found.' }, { status: 404 })
        : planeJsonResponse(state.members)
    }
    const lookup = new RegExp(`^${ws}/${fixture.flavor}/([^/]+)-(\\d+)/$`).exec(path)
    if (lookup) {
      const all = [...state.items.values()].flat()
      const projectId = fixture.projects.find((p) => p.identifier === lookup[1])?.id
      const item = all.find((i) => i.project === projectId && i.sequence_id === Number(lookup[2]))
      return item
        ? planeJsonResponse(item)
        : planeJsonResponse({ detail: 'Not found.' }, { status: 404 })
    }
    const match =
      /^\/workspaces\/acme\/projects\/([^/]+)\/([^/]+)\/(?:([^/]+)\/(comments\/)?)?$/.exec(path)
    if (!match || !fixture.projects.some((p) => p.id === match[1])) {
      return undefined
    }
    const [, projectId, flavor, itemId, comments] = match
    if (flavor === 'states' && !itemId) {
      return planeJsonResponse(rawPlaneStates(projectIndexOf(projectId)))
    }
    if (flavor === 'members' && !itemId) {
      return planeJsonResponse([PLANE_FIXTURE_MEMBER])
    }
    if (flavor !== fixture.flavor) {
      return undefined
    }
    const items = state.items.get(projectId) ?? []
    if (!itemId) {
      const sorted = [...items].sort((a, b) =>
        String(b.updated_at).localeCompare(String(a.updated_at))
      )
      return planeJsonResponse(page(sorted, search))
    }
    const item = items.find((i) => i.id === itemId)
    if (!item) {
      return planeJsonResponse({ detail: 'Not found.' }, { status: 404 })
    }
    if (comments) {
      const list = state.comments.get(itemId) ?? []
      if (method === 'POST') {
        const html = bodyField(body, 'comment_html')
        const created = {
          id: fixtureUuid(COMMENT_BASE + list.length),
          comment_html: html,
          actor: PLANE_FIXTURE_VIEWER.id,
          created_at: '2026-03-01T00:00:00Z'
        }
        state.comments.set(itemId, [...list, created])
        return planeJsonResponse(created, { status: 201 })
      }
      return planeJsonResponse(page(list, search))
    }
    if (method === 'PATCH') {
      // Plane answers a PATCH without expanding relations.
      Object.assign(item, { state: bodyField(body, 'state') })
      return planeJsonResponse({ ...item, assignees: [PLANE_FIXTURE_MEMBER.id], labels: [] })
    }
    return planeJsonResponse(item)
  })
  return state
}
