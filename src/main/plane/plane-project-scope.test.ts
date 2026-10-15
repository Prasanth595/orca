import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createPlaneApiFixture,
  fixtureUuid,
  PLANE_FIXTURE_BASES,
  planeConnectParams,
  rawPlaneProject,
  type PlaneApiFixture
} from './__mocks__/plane-api-fixture'
import { loadPlaneMainModule } from './__mocks__/plane-http-module'
import { mapPlaneProject, PLANE_PROJECTS_TTL_MS } from './plane-projects'
import { resolvePlaneProjectScope } from './plane-project-scope'

const project = (n: number) => ({ id: fixtureUuid(n), name: `Project ${n}`, identifier: `P${n}` })

describe('resolvePlaneProjectScope', () => {
  const live = [project(1), project(2)]

  it('needs a scope when none is saved', () => {
    expect(resolvePlaneProjectScope(null, live)).toEqual({
      needsScope: true,
      projects: [],
      missingProjectIds: []
    })
  })

  it('follows the live list for all', () => {
    expect(resolvePlaneProjectScope({ mode: 'all' }, live).projects).toEqual(live)
  })

  it('intersects a selection and reports ids that are gone', () => {
    expect(
      resolvePlaneProjectScope(
        { mode: 'selected', projectIds: [fixtureUuid(2), fixtureUuid(9)] },
        live
      )
    ).toEqual({ needsScope: false, projects: [project(2)], missingProjectIds: [fixtureUuid(9)] })
  })
})

describe('mapPlaneProject', () => {
  it.each([
    [{ archived_at: '2026-01-01T00:00:00Z' }],
    [{ is_member: false }],
    [{ id: 'nope' }],
    [{ identifier: 'has space' }]
  ])('skips %j', (extra) => {
    expect(mapPlaneProject(rawPlaneProject(1, extra))).toBeNull()
  })

  it('keeps a project without the optional fields and ignores unknown ones', () => {
    expect(
      mapPlaneProject({ id: fixtureUuid(1), identifier: 'web', name: ' Web ', extra: 1 })
    ).toEqual({
      id: fixtureUuid(1),
      name: 'Web',
      identifier: 'WEB'
    })
  })
})

describe.each(PLANE_FIXTURE_BASES)('Plane projects on $name', (base) => {
  let tempHome = ''
  let fixture: PlaneApiFixture
  let plane: Awaited<ReturnType<typeof loadPlaneMainModule>>

  beforeEach(async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    tempHome = mkdtempSync(join(tmpdir(), 'orca-plane-scope-'))
    fixture = createPlaneApiFixture(base.apiBaseUrl)
    plane = await loadPlaneMainModule(vi.fn(fixture.fetch), tempHome)
    await plane.commands.planeConnect(planeConnectParams(base))
  })

  afterEach(() => {
    vi.useRealTimers()
    rmSync(tempHome, { recursive: true, force: true })
  })

  it('picks up a project created after connecting once the cache expires', async () => {
    plane.commands.planeSetProjectScope({ scope: { mode: 'all' } })
    fixture.projects.push(rawPlaneProject(3))
    expect(await plane.commands.planeListProjects()).toHaveLength(2)
    vi.advanceTimersByTime(PLANE_PROJECTS_TTL_MS)
    const live = await plane.commands.planeListProjects()
    expect(live.map((p) => p.identifier)).toEqual(['P1', 'P2', 'P3'])
    expect(resolvePlaneProjectScope({ mode: 'all' }, live).projects).toHaveLength(3)
  })

  it('refreshes on demand and leaves archived projects out', async () => {
    fixture.projects.push(rawPlaneProject(4, { archived_at: '2026-01-01T00:00:00Z' }))
    fixture.projects.push(rawPlaneProject(5))
    const live = await plane.commands.planeListProjects({ refresh: true })
    expect(live.map((p) => p.identifier)).toEqual(['P1', 'P2', 'P5'])
  })

  it('never rewrites a selection whose project disappeared', async () => {
    const scope = { mode: 'selected' as const, projectIds: [fixtureUuid(1), fixtureUuid(2)] }
    plane.commands.planeSetProjectScope({ scope })
    fixture.projects.splice(1, 1)
    const live = await plane.commands.planeListProjects({ refresh: true })
    expect(resolvePlaneProjectScope(scope, live).missingProjectIds).toEqual([fixtureUuid(2)])
    expect(plane.commands.planeStatus()).toMatchObject({ connection: { projectScope: scope } })
  })
})
