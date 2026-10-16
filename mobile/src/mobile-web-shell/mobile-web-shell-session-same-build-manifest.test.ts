import { describe, expect, it } from 'vitest'
import type { CachedGeneration } from './mobile-web-shell-session-contract'
import {
  CACHED,
  MANIFEST_WIRE,
  PAGE_ROUTES,
  ROUTE,
  afterCacheRead,
  createMobileWebShellSession,
  gates,
  manifestFacts,
  run
} from './mobile-web-shell-session-test-fixtures'

/** A route listed with a grant this shell cannot serve, so the route stays native. */
const UNSERVED_ROUTES = [{ pathname: '/h/[hostId]', grants: ['navigate', 'teleport'] }]
const STALE: CachedGeneration = { ...CACHED, routes: UNSERVED_ROUTES }
const FRESH = manifestFacts({ ...MANIFEST_WIRE, routes: PAGE_ROUTES })

const OPEN_CACHED = {
  kind: 'open-generation',
  directory: CACHED.directory,
  buildId: CACHED.buildId,
  totalBytes: CACHED.totalBytes
} as const

/**
 * A matching build id means the bytes on disk are current, so nothing beside them is rewritten:
 * the native view reads `manifest.json` while the page opens, and a rewrite raced that read into a
 * `generation-unreadable` failure that discarded the cache and redownloaded the same build.
 */
describe('a same-build manifest read over a cached generation', () => {
  it('opens the cached generation and emits nothing else', () => {
    const step = run(afterCacheRead(STALE).session, { type: 'manifest-read', manifest: FRESH })

    expect(step.session.state).toEqual({ kind: 'activating', source: 'cache' })
    expect(step.effects).toEqual([OPEN_CACHED])
  })

  it('uses the fresh routes for this session', () => {
    const step = run(afterCacheRead(STALE).session, { type: 'manifest-read', manifest: FRESH })

    expect(step.session.cached?.routes).toEqual(PAGE_ROUTES)
    expect(step.session.routeGrants).toEqual(['navigate'])
  })

  it('emits nothing when the fresh routes take this route native, but holds them', () => {
    const fresh = manifestFacts({ ...MANIFEST_WIRE, routes: UNSERVED_ROUTES })

    const step = run(afterCacheRead(CACHED).session, { type: 'manifest-read', manifest: fresh })

    expect(step.session.state).toEqual({ kind: 'native-route' })
    expect(step.effects).toEqual([])
    expect(step.session.cached?.routes).toEqual(UNSERVED_ROUTES)
  })

  it('keeps the cached routes when the manifest is walled', () => {
    const twoRoutes = [
      { pathname: '/h/[hostId]', grants: ['navigate'] },
      { pathname: '/h/[hostId]/tasks', grants: ['navigate'] }
    ]
    const fresh = manifestFacts({ ...MANIFEST_WIRE, schemaVersion: 99, routes: twoRoutes })

    const step = run(afterCacheRead(CACHED).session, { type: 'manifest-read', manifest: fresh })

    expect(step.session.state).toMatchObject({ kind: 'wall' })
    expect(step.effects).toEqual([])
    expect(step.session.cached?.routes).toEqual(PAGE_ROUTES)
  })

  it('downloads when the cached build is a different one', () => {
    const otherBuild: CachedGeneration = { ...STALE, buildId: 'c'.repeat(64) }

    const step = run(afterCacheRead(otherBuild).session, { type: 'manifest-read', manifest: FRESH })

    expect(step.effects).toEqual([{ kind: 'download' }])
    expect(step.session.cached?.routes).toEqual(UNSERVED_ROUTES)
  })
})

/** The accepted tradeoff: an offline entry is judged by the routes stored at download time. */
describe('the offline entry after a same-build manifest read', () => {
  it('judges the route by the routes the generation was downloaded with', () => {
    const started = run(createMobileWebShellSession(ROUTE), {
      type: 'gates-changed',
      gates: gates({ reachability: 'unreachable' })
    })
    expect(started.effects).toEqual([{ kind: 'open-cache' }])

    const step = run(started.session, { type: 'cache-read', generation: STALE })

    expect(step.session.state).toEqual({ kind: 'native-route' })
    expect(step.session.pageRoutes).toEqual([])
  })
})
