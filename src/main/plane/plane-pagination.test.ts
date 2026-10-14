import { describe, expect, it, vi } from 'vitest'
import { collectPlanePages, parsePlanePage, planePageQuery } from './plane-pagination'

function envelope(results: unknown[], nextCursor: string | null, more = nextCursor !== null) {
  return {
    results,
    next_cursor: nextCursor,
    next_page_results: more,
    total_results: 999,
    extra_field: 'ignored'
  }
}

describe('parsePlanePage', () => {
  it('accepts a bare array', () => {
    expect(parsePlanePage([1, 2])).toEqual({ results: [1, 2], nextCursor: null, totalResults: 2 })
  })

  it('reads the cursor envelope and ignores unknown fields', () => {
    expect(parsePlanePage(envelope([1], '100:1:0'))).toEqual({
      results: [1],
      nextCursor: '100:1:0',
      totalResults: 999
    })
  })

  it('drops the cursor when the server says there are no more results', () => {
    expect(parsePlanePage(envelope([1], '100:1:0', false)).nextCursor).toBeNull()
    expect(parsePlanePage(envelope([1], 'garbage', true)).nextCursor).toBeNull()
  })

  it.each([null, 'x', { results: 'no' }, { items: [] }])('rejects %j', (body) => {
    expect(() => parsePlanePage(body)).toThrow(
      expect.objectContaining({ kind: 'invalid_response' })
    )
  })
})

describe('planePageQuery', () => {
  it('adds the cursor only when given', () => {
    expect(planePageQuery()).toEqual({ per_page: '100' })
    expect(planePageQuery('100:2:0', 50)).toEqual({ per_page: '50', cursor: '100:2:0' })
  })
})

describe('collectPlanePages', () => {
  it('follows the cursor until next_page_results is false', async () => {
    const fetchPage = vi
      .fn()
      .mockResolvedValueOnce(envelope([1, 2], '100:1:0'))
      .mockResolvedValueOnce(envelope([3], '100:2:0', false))
    await expect(collectPlanePages(fetchPage, { maxPages: 10, maxItems: 500 })).resolves.toEqual({
      items: [1, 2, 3],
      nextCursor: null,
      capped: false
    })
    expect(fetchPage.mock.calls).toEqual([[undefined], ['100:1:0']])
  })

  it('stops at maxPages and hands back the resume cursor', async () => {
    const fetchPage = vi.fn().mockResolvedValue(envelope([1], '100:1:0'))
    fetchPage.mockResolvedValueOnce(envelope([1], '100:1:0'))
    await expect(
      collectPlanePages(fetchPage, { maxPages: 1, maxItems: 500, startCursor: '100:0:0' })
    ).resolves.toEqual({ items: [1], nextCursor: '100:1:0', capped: false })
    expect(fetchPage).toHaveBeenCalledWith('100:0:0')
  })

  it('respects the item ceiling', async () => {
    const fetchPage = vi
      .fn()
      .mockResolvedValueOnce(envelope([1, 2], '100:1:0'))
      .mockResolvedValueOnce(envelope([3, 4], '100:2:0'))
    await expect(collectPlanePages(fetchPage, { maxPages: 10, maxItems: 3 })).resolves.toEqual({
      items: [1, 2, 3],
      nextCursor: null,
      capped: true
    })
  })

  it('stops on a repeated cursor', async () => {
    const fetchPage = vi.fn().mockResolvedValue(envelope([1], '100:1:0'))
    const result = await collectPlanePages(fetchPage, { maxPages: 10, maxItems: 500 })
    expect(fetchPage).toHaveBeenCalledTimes(2)
    expect(result).toEqual({ items: [1, 1], nextCursor: null, capped: false })
  })

  it('accepts an unpaginated array in one call', async () => {
    const fetchPage = vi.fn().mockResolvedValue([1, 2, 3])
    await expect(collectPlanePages(fetchPage, { maxPages: 10, maxItems: 500 })).resolves.toEqual({
      items: [1, 2, 3],
      nextCursor: null,
      capped: false
    })
    expect(fetchPage).toHaveBeenCalledTimes(1)
  })
})
