import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createPlaneApiFixture,
  fixtureUuid,
  PLANE_FIXTURE_BASES,
  PLANE_FIXTURE_TOKEN,
  PLANE_FIXTURE_VIEWER,
  planeConnectParams,
  type PlaneApiFixture
} from './__mocks__/plane-api-fixture'
import { loadPlaneMainModule, planeJsonResponse } from './__mocks__/plane-http-module'
import {
  fixtureItemId,
  fixtureStateId,
  installPlaneWorkItemRoutes,
  rawPlaneWorkItem,
  type PlaneWorkItemFixture
} from './__mocks__/plane-work-item-fixture'
import { planeCommentHtml, planeHtmlToText } from './plane-comment-html'
import { PLANE_DESCRIPTION_MAX_CHARS } from './plane-work-item-mapping'

const P1 = fixtureUuid(1)
const ITEM = fixtureItemId(1, 3)
const REF = { projectId: P1, workItemId: ITEM }

describe('planeCommentHtml', () => {
  it('escapes markup, ampersands and quotes and keeps line breaks', () => {
    expect(planeCommentHtml(`<script>alert("x")</script> & 'y'\nnext`)).toBe(
      '<p>&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt; &amp; &#39;y&#39;<br>next</p>'
    )
  })

  it('reads stored HTML back as text', () => {
    expect(planeHtmlToText('<p>a &amp; b<br>c</p><p>d</p>')).toBe('a & b\nc\nd')
  })
})

describe.each(PLANE_FIXTURE_BASES)('Plane work item read and write on $name', (base) => {
  let tempHome = ''
  let fixture: PlaneApiFixture
  let state: PlaneWorkItemFixture
  let plane: Awaited<ReturnType<typeof loadPlaneMainModule>>

  beforeEach(async () => {
    tempHome = mkdtempSync(join(tmpdir(), 'orca-plane-write-'))
    fixture = createPlaneApiFixture(base.apiBaseUrl)
    state = installPlaneWorkItemRoutes(fixture)
    state.items.set(P1, [rawPlaneWorkItem(1, 3)])
    plane = await loadPlaneMainModule(vi.fn(fixture.fetch), tempHome)
    await plane.commands.planeConnect(planeConnectParams(base))
    fixture.requests.length = 0
  })

  afterEach(() => {
    rmSync(tempHome, { recursive: true, force: true })
  })

  it('reads the detail as plain text', async () => {
    await expect(plane.workItems.planeGetWorkItem(REF)).resolves.toMatchObject({
      identifier: 'P1-3',
      descriptionText: 'Description of item 3',
      truncated: false
    })
  })

  it('truncates a very long description', async () => {
    state.items.set(P1, [
      rawPlaneWorkItem(1, 3, { description_stripped: 'y'.repeat(PLANE_DESCRIPTION_MAX_CHARS + 5) })
    ])
    const detail = await plane.workItems.planeGetWorkItem(REF)
    expect(detail.truncated).toBe(true)
    expect(detail.descriptionText).toHaveLength(PLANE_DESCRIPTION_MAX_CHARS)
  })

  it('looks an item up by identifier', async () => {
    await expect(
      plane.workItems.planeLookupWorkItem({ identifier: 'P1-3' })
    ).resolves.toMatchObject({
      id: ITEM,
      projectId: P1
    })
    await expect(plane.workItems.planeLookupWorkItem({ identifier: 'ZZ-3' })).rejects.toMatchObject(
      {
        kind: 'not_found'
      }
    )
  })

  it('names comment authors from the member list', async () => {
    state.comments.set(ITEM, [
      {
        id: fixtureUuid(60_002),
        comment_stripped: 'second',
        actor: PLANE_FIXTURE_VIEWER.id,
        created_at: '2026-02-02'
      },
      {
        id: fixtureUuid(60_001),
        comment_html: '<p>first &amp; best</p>',
        actor_detail: { id: fixtureUuid(5), display_name: 'grace' },
        created_at: '2026-02-01'
      }
    ])
    state.workspaceMembersMissing = true
    await expect(plane.workItems.planeListComments(REF)).resolves.toEqual([
      {
        id: fixtureUuid(60_001),
        authorName: 'grace',
        text: 'first & best',
        createdAt: '2026-02-01'
      },
      { id: fixtureUuid(60_002), authorName: 'ada', text: 'second', createdAt: '2026-02-02' }
    ])
    expect(fixture.requests.map((r) => r.path)).toContain(
      `/workspaces/acme/projects/${P1}/members/`
    )
  })

  it('patches only the state and maps the unexpanded reply', async () => {
    const stateId = fixtureStateId(1, 2)
    const item = await plane.workItems.planeUpdateState({ ...REF, stateId })
    const patch = fixture.requests.find((r) => r.method === 'PATCH')
    expect(patch).toMatchObject({
      path: `/workspaces/acme/projects/${P1}/work-items/${ITEM}/`,
      body: { state: stateId }
    })
    expect(item).toMatchObject({
      state: { id: stateId, name: 'Done' },
      assignees: [{ displayName: 'ada' }]
    })
    expect(JSON.stringify(item)).not.toContain(PLANE_FIXTURE_TOKEN)
  })

  it('says the token has no permission when a write is forbidden', async () => {
    fixture.routes.unshift(({ method }) =>
      method === 'PATCH' || method === 'POST'
        ? planeJsonResponse({ detail: 'You do not have permission' }, { status: 403 })
        : undefined
    )
    const stateId = fixtureStateId(1, 2)
    await expect(plane.workItems.planeUpdateState({ ...REF, stateId })).rejects.toMatchObject({
      kind: 'forbidden',
      message: expect.stringContaining('no permission')
    })
    await expect(plane.workItems.planeAddComment({ ...REF, text: 'hi' })).rejects.toMatchObject({
      kind: 'forbidden',
      message: expect.stringContaining('no permission')
    })
  })

  it('never retries a rate-limited write', async () => {
    fixture.routes.unshift(({ method }) =>
      method === 'PATCH'
        ? planeJsonResponse({}, { status: 429, headers: { 'retry-after': '1' } })
        : undefined
    )
    await expect(
      plane.workItems.planeUpdateState({ ...REF, stateId: fixtureStateId(1, 0) })
    ).rejects.toMatchObject({ kind: 'rate_limited' })
    expect(fixture.requests.filter((r) => r.method === 'PATCH')).toHaveLength(1)
  })

  it('posts an escaped comment and returns it', async () => {
    const text = `<script>alert("x")</script> & 'y'\nline two`
    const comment = await plane.workItems.planeAddComment({ ...REF, text })
    const post = fixture.requests.find((r) => r.method === 'POST')
    expect(post?.path).toBe(`/workspaces/acme/projects/${P1}/work-items/${ITEM}/comments/`)
    expect(post?.body).toEqual({ comment_html: planeCommentHtml(text) })
    expect(comment).toMatchObject({
      authorName: 'ada',
      text: `<script>alert("x")</script> & 'y'\nline two`
    })
  })

  it('rejects an item in a project outside the workspace before any request', async () => {
    await expect(
      plane.workItems.planeGetWorkItem({ projectId: fixtureUuid(77), workItemId: ITEM })
    ).rejects.toMatchObject({ kind: 'not_found' })
    expect(fixture.requests.some((r) => r.path.includes(fixtureUuid(77)))).toBe(false)
  })
})
