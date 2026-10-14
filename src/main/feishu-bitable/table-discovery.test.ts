import { beforeEach, describe, expect, it, vi } from 'vitest'
const request = vi.hoisted(() => vi.fn())
vi.mock('./client', () => ({ feishuRequest: request }))
import { discoverTables } from './table-discovery'
const args = {
  appId: 'cli123',
  appSecret: 'secret',
  appToken: 'https://team.feishu.cn/base/base123?from=from_copylink'
}
beforeEach(() => request.mockReset())
describe('discoverTables', () => {
  it('collects paginated table names and IDs using existing authenticated requests', async () => {
    request
      .mockResolvedValueOnce({
        items: [{ table_id: 'tbl1', name: 'Tasks' }],
        has_more: true,
        page_token: 'next'
      })
      .mockResolvedValueOnce({ items: [{ table_id: 'tbl2', name: 'Bugs' }], has_more: false })
    expect(await discoverTables(args)).toEqual({
      ok: true,
      tables: [
        { tableId: 'tbl1', name: 'Tasks' },
        { tableId: 'tbl2', name: 'Bugs' }
      ]
    })
    expect(request.mock.calls[0][0]).toBe('/open-apis/bitable/v1/apps/base123/tables?page_size=100')
    expect(request.mock.calls[1][0]).toContain('page_token=next')
    expect(request.mock.calls[0][1]).toEqual({
      method: 'GET',
      auth: { appId: 'cli123', appSecret: 'secret' }
    })
  })
  it('rejects repeated cursors rather than looping or returning incomplete options', async () => {
    request.mockResolvedValue({ items: [], has_more: true, page_token: 'same' })
    expect(await discoverTables(args)).toMatchObject({
      ok: false,
      error: expect.stringContaining('pagination')
    })
    expect(request).toHaveBeenCalledTimes(2)
  })
  it('returns permission errors and empty lists without saving credentials', async () => {
    request.mockRejectedValueOnce(new Error('Access denied'))
    expect(await discoverTables(args)).toEqual({ ok: false, error: 'Access denied' })
    request.mockResolvedValueOnce({ items: [], has_more: false })
    expect(await discoverTables(args)).toEqual({ ok: true, tables: [] })
  })
  it('rejects invalid credentials and links before requesting', async () => {
    expect(await discoverTables({ ...args, appSecret: '' })).toMatchObject({ ok: false })
    expect(
      await discoverTables({ ...args, appToken: 'https://evil.com/base/token' })
    ).toMatchObject({ ok: false })
    expect(request).not.toHaveBeenCalled()
  })
})
