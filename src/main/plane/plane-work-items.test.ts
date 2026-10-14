import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createPlaneApiFixture,
  fixtureUuid,
  PLANE_FIXTURE_BASES,
  PLANE_FIXTURE_TOKEN,
  planeConnectParams,
  rawPlaneProject,
  type PlaneApiFixture
} from './__mocks__/plane-api-fixture'
import { loadPlaneMainModule } from './__mocks__/plane-http-module'
import {
  fixtureItemId,
  fixtureStateId,
  installPlaneWorkItemRoutes,
  PLANE_FIXTURE_MEMBER,
  rawPlaneWorkItem,
  type PlaneWorkItemFixture
} from './__mocks__/plane-work-item-fixture'

const P1 = fixtureUuid(1)
const P2 = fixtureUuid(2)
const ONE_MIB = 1024 * 1024

let tempHome = ''

beforeEach(() => {
  tempHome = mkdtempSync(join(tmpdir(), 'orca-plane-items-'))
})

afterEach(() => {
  rmSync(tempHome, { recursive: true, force: true })
})

function seed(state: PlaneWorkItemFixture, projectIndex: number, count: number, extra = {}) {
  const items = Array.from({ length: count }, (_, i) =>
    rawPlaneWorkItem(projectIndex, i + 1, extra)
  )
  state.items.set(fixtureUuid(projectIndex), items)
}

describe.each(PLANE_FIXTURE_BASES)('listPlaneWorkItems on $name', (base) => {
  let fixture: PlaneApiFixture
  let state: PlaneWorkItemFixture
  let plane: Awaited<ReturnType<typeof loadPlaneMainModule>>

  async function connectWith(projectCount: number, scope: 'all' | string[] = 'all') {
    fixture = createPlaneApiFixture(base.apiBaseUrl)
    fixture.projects = Array.from({ length: projectCount }, (_, i) => rawPlaneProject(i + 1))
    state = installPlaneWorkItemRoutes(fixture)
    plane = await loadPlaneMainModule(vi.fn(fixture.fetch), tempHome)
    await plane.commands.planeConnect(planeConnectParams(base))
    plane.commands.planeSetProjectScope({
      scope: scope === 'all' ? { mode: 'all' } : { mode: 'selected', projectIds: scope }
    })
    fixture.requests.length = 0
  }

  it('fans out over every project for all, newest first, fully mapped', async () => {
    await connectWith(2)
    seed(state, 1, 2)
    seed(state, 2, 1)
    const list = await plane.workItems.planeListWorkItems()
    expect(list.items.map((i) => i.identifier)).toEqual(['P1-2', 'P2-1', 'P1-1'])
    const webBaseUrl = base.hostKind === 'cloud' ? 'https://app.plane.so' : base.serverUrl
    expect(list.items[1]).toEqual({
      connectionId: expect.any(String),
      id: fixtureItemId(2, 1),
      projectId: P2,
      projectIdentifier: 'P2',
      sequenceId: 1,
      identifier: 'P2-1',
      name: 'Item 1 of project 2',
      state: {
        id: fixtureStateId(2, 1),
        name: 'Todo',
        group: 'unstarted',
        color: '#aaa',
        sequence: 2
      },
      priority: 'high',
      assignees: [{ id: PLANE_FIXTURE_MEMBER.id, displayName: 'ada' }],
      labels: [{ id: fixtureUuid(90_001), name: 'bug', color: '#f00' }],
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: expect.any(String),
      url: `${webBaseUrl}/acme/projects/${P2}/issues/${fixtureItemId(2, 1)}`
    })
    expect(list).toMatchObject({
      errors: [],
      missingProjectIds: [],
      truncatedProjectIds: [],
      totalCapped: false
    })
    const listCall = fixture.requests.find((r) => r.path.endsWith('/work-items/'))
    expect(new URLSearchParams(listCall?.search)).toEqual(
      new URLSearchParams({
        per_page: '100',
        order_by: '-updated_at',
        expand: 'state,assignees,labels'
      })
    )
    expect(JSON.stringify(list)).not.toContain(PLANE_FIXTURE_TOKEN)
  })

  it('intersects a selection and reports projects that are gone', async () => {
    await connectWith(2, [P1, fixtureUuid(99)])
    seed(state, 1, 1)
    seed(state, 2, 1)
    const list = await plane.workItems.planeListWorkItems()
    expect(list.items.map((i) => i.projectId)).toEqual([P1])
    expect(list.missingProjectIds).toEqual([fixtureUuid(99)])
  })

  it('never widens the saved scope from the request', async () => {
    await connectWith(2, [P1])
    const list = await plane.workItems.planeListWorkItems({ projectIds: [P2] })
    expect(list).toMatchObject({ items: [], missingProjectIds: [P2] })
    expect(fixture.requests.some((r) => r.path.includes(P2))).toBe(false)
  })

  it('asks for a scope instead of listing anything', async () => {
    fixture = createPlaneApiFixture(base.apiBaseUrl)
    plane = await loadPlaneMainModule(vi.fn(fixture.fetch), tempHome)
    await plane.commands.planeConnect(planeConnectParams(base))
    await expect(plane.workItems.planeListWorkItems()).resolves.toMatchObject({
      items: [],
      needsScope: true
    })
  })

  it('keeps other projects when one is forbidden', async () => {
    await connectWith(2)
    seed(state, 1, 1)
    seed(state, 2, 1)
    fixture.failures.set(`/projects/${P2}/work-items/`, 403)
    const list = await plane.workItems.planeListWorkItems()
    expect(list.items.map((i) => i.identifier)).toEqual(['P1-1'])
    expect(list.errors).toEqual([{ projectId: P2, kind: 'forbidden' }])
  })

  it('marks a truncated project and loads more from its cursor', async () => {
    await connectWith(1)
    seed(state, 1, 150)
    const first = await plane.workItems.planeListWorkItems()
    expect(first).toMatchObject({
      truncatedProjectIds: [P1],
      nextCursorByProject: { [P1]: '100:1:0' }
    })
    expect(first.items).toHaveLength(100)
    const more = await plane.workItems.planeListWorkItems({ cursorByProject: { [P1]: '100:1:0' } })
    expect(more.items).toHaveLength(50)
    expect(more.truncatedProjectIds).toEqual([])
  })

  it('caps the total at 500 and keeps the payload under 1 MiB', async () => {
    await connectWith(6)
    const long = {
      name: 'x'.repeat(255),
      assignees: [PLANE_FIXTURE_MEMBER, PLANE_FIXTURE_MEMBER, PLANE_FIXTURE_MEMBER],
      labels: [1, 2, 3].map((n) => ({
        id: fixtureUuid(90_000 + n),
        name: 'label-name'.repeat(3),
        color: '#123456'
      }))
    }
    for (let p = 1; p <= 6; p += 1) {
      seed(state, p, 100, long)
    }
    const list = await plane.workItems.planeListWorkItems()
    expect(list.items).toHaveLength(500)
    expect(list.totalCapped).toBe(true)
    expect(Buffer.byteLength(JSON.stringify(list))).toBeLessThan(ONE_MIB)
  })

  it('loads 20 projects in at most 23 requests, and refreshes in at most 21', async () => {
    await connectWith(20)
    for (let p = 1; p <= 20; p += 1) {
      seed(state, p, 3)
    }
    // A fresh module graph is a fresh app start: no project, flavor or metadata cache.
    plane = await loadPlaneMainModule(vi.fn(fixture.fetch), tempHome)
    fixture.requests.length = 0
    const list = await plane.workItems.planeListWorkItems()
    expect(list.items).toHaveLength(60)
    expect(fixture.requests.length).toBeLessThanOrEqual(23)
    fixture.requests.length = 0
    await plane.workItems.planeListWorkItems({ refresh: true })
    expect(fixture.requests.length).toBeLessThanOrEqual(21)
  })

  it('joins states and members when the server does not expand them', async () => {
    await connectWith(1)
    seed(state, 1, 2, {
      state: fixtureStateId(1, 2),
      assignees: [PLANE_FIXTURE_MEMBER.id],
      labels: []
    })
    const list = await plane.workItems.planeListWorkItems()
    expect(list.items[0]).toMatchObject({
      state: { name: 'Done', group: 'completed' },
      assignees: [{ id: PLANE_FIXTURE_MEMBER.id, displayName: 'ada' }]
    })
    const paths = fixture.requests.map((r) => r.path)
    expect(paths.filter((p) => p.endsWith('/states/'))).toHaveLength(1)
    expect(paths.filter((p) => p.endsWith('/members/'))).toHaveLength(1)
  })

  it('reports every project when no project can tell the API flavor', async () => {
    await connectWith(2)
    plane = await loadPlaneMainModule(vi.fn(fixture.fetch), tempHome)
    fixture.failures.set('/work-items/', 403)
    const list = await plane.workItems.planeListWorkItems()
    expect(list.errors).toEqual([
      { projectId: P1, kind: 'forbidden' },
      { projectId: P2, kind: 'forbidden' }
    ])
  })
})
