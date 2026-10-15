import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { readLinearDocumentContent, readLinearProjectContent } from './linear-content-read'

const mocks = vi.hoisted(() => ({
  rawRequest: vi.fn(),
  getClients: vi.fn(),
  isAuthError: vi.fn(),
  clearToken: vi.fn(),
  acquire: vi.fn(),
  release: vi.fn()
}))
vi.mock('./client', () => ({
  getClients: mocks.getClients,
  isAuthError: mocks.isAuthError,
  getStatus: vi.fn(),
  getPublicFileUrlClient: vi.fn()
}))
vi.mock('./linear-token-store', () => ({ clearToken: mocks.clearToken }))
vi.mock('./linear-request-concurrency', () => ({ acquire: mocks.acquire, release: mocks.release }))

const workspaceId = '11111111-1111-4111-8111-111111111111'
const projectId = '22222222-2222-4222-8222-222222222222'
const documentId = '33333333-3333-4333-8333-333333333333'
const request = { id: projectId, workspaceId, full: true }
const project = {
  id: projectId,
  name: 'Migration',
  url: 'https://linear.app/example/project/migration',
  description: 'Summary',
  content: '# Full project\n\nAcceptance details',
  updatedAt: '2026-10-15T00:00:00Z'
}
function document(id = documentId) {
  return {
    id,
    slugId: `doc-${id}`,
    title: 'Contract',
    url: `https://linear.app/example/document/${id}`,
    content: '# Full document\n\n- [ ] Acceptance criteria',
    updatedAt: project.updatedAt,
    project: { id: projectId },
    issue: null
  }
}
function page(ids: string[], hasNextPage = false, endCursor: string | null = null) {
  return {
    data: {
      project: {
        ...project,
        documents: { nodes: ids.map((id) => document(id)), pageInfo: { hasNextPage, endCursor } }
      }
    }
  }
}
function uuid(index: number) {
  return `33333333-3333-4333-8333-${String(index).padStart(12, '0')}`
}

beforeEach(() => {
  vi.resetAllMocks()
  mocks.acquire.mockResolvedValue(undefined)
  mocks.getClients.mockReturnValue([
    { workspace: { id: workspaceId }, client: { client: { rawRequest: mocks.rawRequest } } }
  ])
})
afterEach(() => vi.useRealTimers())

describe('Linear content reads through the existing workspace client', () => {
  it('returns complete project and all document Markdown across pages', async () => {
    mocks.rawRequest
      .mockResolvedValueOnce(page([documentId], true, 'next'))
      .mockResolvedValueOnce(page([uuid(2)]))
    const result = await readLinearProjectContent(request)
    expect(result.project).toEqual({ ...project, workspaceId })
    expect(result.documents).toEqual(
      [document(documentId), document(uuid(2))].map((doc) => ({ ...doc, workspaceId }))
    )
    expect(result.meta).toMatchObject({
      partial: false,
      includeErrors: [],
      sections: { documents: { returned: 2, hasMore: false } }
    })
    expect(mocks.getClients).toHaveBeenCalledWith(workspaceId)
    expect(mocks.rawRequest).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining('documents(first: $first, after: $after)'),
      { id: projectId, full: true, first: 10, after: 'next' }
    )
    expect(mocks.acquire).toHaveBeenCalledTimes(2)
    expect(mocks.release).toHaveBeenCalledTimes(2)
  })

  it('reports the bounded document cap as partial with a continuation cursor', async () => {
    mocks.rawRequest
      .mockResolvedValueOnce(
        page(
          Array.from({ length: 10 }, (_, i) => uuid(i)),
          true,
          'page2'
        )
      )
      .mockResolvedValueOnce(
        page(
          Array.from({ length: 10 }, (_, i) => uuid(i + 10)),
          true,
          'page3'
        )
      )
    const result = await readLinearProjectContent(request)
    expect(result.documents).toHaveLength(20)
    expect(result.meta).toMatchObject({
      partial: true,
      includeErrors: [{ code: 'linear_partial' }],
      sections: {
        documents: { returned: 20, cap: 20, capReached: true, hasMore: true, nextCursor: 'page3' }
      }
    })
    expect(mocks.rawRequest).toHaveBeenCalledTimes(2)
  })

  it('does not claim document completeness when --full was not requested', async () => {
    mocks.rawRequest.mockResolvedValue({ data: { project } })
    const result = await readLinearProjectContent({ ...request, full: false })
    expect(result).toMatchObject({ documents: [], meta: { partial: false, sections: {} } })
    expect(mocks.rawRequest).toHaveBeenCalledWith(expect.any(String), {
      id: projectId,
      full: false,
      first: 10
    })
  })

  it.each([documentId, `doc-${documentId}`])(
    'reads full document by id or slug: %s',
    async (id) => {
      mocks.rawRequest.mockResolvedValue({ data: { document: document() } })
      await expect(readLinearDocumentContent({ id, workspaceId })).resolves.toMatchObject({
        document: { ...document(), workspaceId },
        meta: { partial: false, contentComplete: true }
      })
    }
  )

  it('distinguishes fetched null Markdown from a missing content field', async () => {
    mocks.rawRequest
      .mockResolvedValueOnce({ data: { document: { ...document(), content: null } } })
      .mockResolvedValueOnce({ data: { document: { ...document(), content: undefined } } })
    await expect(readLinearDocumentContent({ id: documentId, workspaceId })).resolves.toMatchObject(
      { document: { content: null }, meta: { contentComplete: true } }
    )
    await expect(readLinearDocumentContent({ id: documentId, workspaceId })).rejects.toMatchObject({
      code: 'linear_partial'
    })
  })

  it.each(['all', 'Example', ''])(
    'rejects non-UUID workspace %s before client access',
    async (id) => {
      await expect(
        readLinearDocumentContent({ id: documentId, workspaceId: id })
      ).rejects.toMatchObject({ code: 'linear_invalid_workspace' })
      expect(mocks.getClients).not.toHaveBeenCalled()
    }
  )

  it('rejects a client for a different workspace', async () => {
    mocks.getClients.mockReturnValue([{ workspace: { id: projectId } }])
    await expect(readLinearProjectContent(request)).rejects.toMatchObject({
      code: 'linear_invalid_workspace'
    })
    expect(mocks.rawRequest).not.toHaveBeenCalled()
  })

  it('rejects a disconnected workspace without reading credentials', async () => {
    mocks.getClients.mockReturnValue([])
    await expect(readLinearProjectContent(request)).rejects.toMatchObject({
      code: 'linear_not_connected'
    })
  })

  it.each([
    { data: { project: null } },
    { data: { project }, errors: [{ message: 'private provider error' }] },
    { data: { project: { ...project, id: documentId } } },
    { data: { project } },
    page([], true, 'cursor'),
    page([documentId], true, null)
  ])('fails closed on incomplete or inconsistent project responses', async (response) => {
    mocks.rawRequest.mockResolvedValue(response)
    await expect(readLinearProjectContent(request)).rejects.toMatchObject({
      code: 'linear_partial'
    })
  })

  it('rejects duplicate documents and moving project snapshots', async () => {
    mocks.rawRequest
      .mockResolvedValueOnce(page([documentId], true, 'next'))
      .mockResolvedValueOnce(page([documentId]))
    await expect(readLinearProjectContent(request)).rejects.toMatchObject({
      code: 'linear_partial'
    })
    mocks.rawRequest.mockResolvedValueOnce(page([documentId], true, 'next')).mockResolvedValueOnce({
      data: { project: { ...page([uuid(2)]).data.project, content: 'changed' } }
    })
    await expect(readLinearProjectContent(request)).rejects.toMatchObject({
      code: 'linear_partial'
    })
  })

  it('rejects foreign project membership and wrong document identity', async () => {
    mocks.rawRequest.mockResolvedValueOnce({
      data: {
        project: {
          ...project,
          documents: {
            nodes: [{ ...document(), project: null }],
            pageInfo: { hasNextPage: false, endCursor: null }
          }
        }
      }
    })
    await expect(readLinearProjectContent(request)).rejects.toMatchObject({
      code: 'linear_partial'
    })
    mocks.rawRequest.mockResolvedValueOnce({ data: { document: document(uuid(9)) } })
    await expect(readLinearDocumentContent({ id: documentId, workspaceId })).rejects.toMatchObject({
      code: 'linear_partial'
    })
  })

  it('rejects oversized Markdown without silently truncating it', async () => {
    mocks.rawRequest.mockResolvedValue({
      data: { document: { ...document(), content: 'x'.repeat(2 * 1024 * 1024) } }
    })
    await expect(readLinearDocumentContent({ id: documentId, workspaceId })).rejects.toMatchObject({
      code: 'linear_partial'
    })
  })

  it('returns a complete empty document collection', async () => {
    mocks.rawRequest.mockResolvedValue(page([]))
    await expect(readLinearProjectContent(request)).resolves.toMatchObject({
      documents: [],
      meta: {
        partial: false,
        sections: {
          documents: { returned: 0, capReached: false, hasMore: false, nextCursor: null }
        }
      }
    })
  })

  it.each([
    ['403 forbidden', 'linear_permission_denied'],
    ['429 rate limited', 'linear_rate_limited'],
    ['fetch failed', 'linear_network_error']
  ])('preserves classified read failures without mutation or retry: %s', async (message, code) => {
    mocks.rawRequest.mockRejectedValue(new Error(`${message} Authorization: Bearer fixture-secret`))
    const result = readLinearProjectContent(request)
    await expect(result).rejects.toMatchObject({
      code,
      message: `${message} Authorization: Bearer [REDACTED]`
    })
    expect(mocks.rawRequest).toHaveBeenCalledTimes(1)
    expect(mocks.rawRequest).toHaveBeenCalledWith(
      expect.stringMatching(/^\s*query /),
      expect.any(Object)
    )
    expect(mocks.clearToken).not.toHaveBeenCalled()
    expect(mocks.release).toHaveBeenCalledTimes(1)
  })

  it('rejects repeated cursors even when the returned document ids differ', async () => {
    mocks.rawRequest
      .mockResolvedValueOnce(page([documentId], true, 'same'))
      .mockResolvedValueOnce(page([uuid(4)], true, 'same'))
    await expect(readLinearProjectContent(request)).rejects.toMatchObject({
      code: 'linear_partial'
    })
  })

  it('preserves existing auth-error handling and releases the read permit', async () => {
    mocks.isAuthError.mockReturnValue(true)
    mocks.rawRequest.mockRejectedValue(new Error('expired'))
    await expect(readLinearProjectContent(request)).rejects.toMatchObject({
      code: 'linear_auth_expired'
    })
    expect(mocks.clearToken).toHaveBeenCalledWith(workspaceId)
    expect(mocks.release).toHaveBeenCalledTimes(1)
  })

  it('times out without releasing the permit of a still-pending SDK read', async () => {
    vi.useFakeTimers()
    let settle: (value: unknown) => void = () => {
      throw new Error('read not started')
    }
    mocks.rawRequest.mockImplementation(
      () =>
        new Promise((resolve) => {
          settle = resolve
        })
    )
    const pending = expect(readLinearProjectContent(request)).rejects.toMatchObject({
      code: 'linear_timeout'
    })
    await vi.advanceTimersByTimeAsync(30_000)
    await pending
    expect(mocks.release).not.toHaveBeenCalled()
    settle(page([]))
    await vi.advanceTimersByTimeAsync(0)
    expect(mocks.release).toHaveBeenCalledTimes(1)
  })
})
