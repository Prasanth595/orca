import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const fetchMock = vi.fn()

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' }
  })
}

function tokenBody(expire = 7200): {
  code: number
  msg: string
  tenant_access_token: string
  expire: number
} {
  return { code: 0, msg: 'ok', tenant_access_token: 'tenant-token', expire }
}

function recordsBody(args: { ids: string[]; hasMore?: boolean; pageToken?: string }): unknown {
  return {
    code: 0,
    msg: 'ok',
    data: {
      items: args.ids.map((id) => ({
        record_id: id,
        fields: { 标题: [{ text: `Task ${id}` }] },
        last_modified_time: '2026-02-03T04:05:06.000Z'
      })),
      has_more: args.hasMore ?? false,
      ...(args.pageToken ? { page_token: args.pageToken } : {})
    }
  }
}

async function loadClient() {
  vi.resetModules()
  // Why inside: resetModules() gives the http-client module a fresh singleton,
  // so the port must be installed on that instance, not the pre-reset import.
  const { setMainHttpClient } = await import('../network/http-client')
  setMainHttpClient({
    fetch: (url, init) => fetchMock(url, init),
    // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: Feishu reads never touch the proxy session; the field only satisfies the http-client port shape.
    proxySession: () => ({}) as never
  })
  return import('./client')
}

beforeEach(() => {
  fetchMock.mockReset()
})

afterEach(() => {
  vi.restoreAllMocks()
})

const REFERENCE = { appToken: 'app-token-a', tableId: 'tbl-alpha' }

describe('feishu bitable client', () => {
  it('fetches a tenant token once and reuses it across record reads', async () => {
    const client = await loadClient()
    fetchMock
      .mockResolvedValueOnce(jsonResponse(tokenBody()))
      .mockResolvedValueOnce(jsonResponse(recordsBody({ ids: ['rec-1'] })))
      .mockResolvedValueOnce(jsonResponse(recordsBody({ ids: ['rec-2'] })))

    await client.listRecordsPage({ appId: 'cli_app', appSecret: 's3cret', reference: REFERENCE })
    await client.listRecordsPage({ appId: 'cli_app', appSecret: 's3cret', reference: REFERENCE })

    const tokenCalls = fetchMock.mock.calls.filter(([url]) =>
      String(url).includes('/auth/v3/tenant_access_token/internal')
    )
    expect(tokenCalls).toHaveLength(1)
    const headers = fetchMock.mock.calls[1]?.[1]?.headers ?? {}
    expect(headers['Authorization']).toBe('Bearer tenant-token')
  })

  it('keeps the app secret out of URLs and non-token request payloads', async () => {
    const client = await loadClient()
    fetchMock
      .mockResolvedValueOnce(jsonResponse(tokenBody()))
      .mockResolvedValueOnce(jsonResponse(recordsBody({ ids: ['rec-1'] })))

    await client.listRecordsPage({ appId: 'cli_app', appSecret: 's3cret', reference: REFERENCE })
    for (const [url, init] of fetchMock.mock.calls) {
      expect(String(url)).not.toContain('s3cret')
      // The token endpoint is the one place the secret belongs; records reads carry none.
      if (!String(url).includes('/auth/v3/tenant_access_token/internal')) {
        expect(JSON.stringify(init?.body ?? {})).not.toContain('s3cret')
      }
    }
  })

  it('walks cursor pages and surfaces the next page token only while has_more', async () => {
    const client = await loadClient()
    fetchMock
      .mockResolvedValueOnce(jsonResponse(tokenBody()))
      .mockResolvedValueOnce(
        jsonResponse(recordsBody({ ids: ['rec-1'], hasMore: true, pageToken: 'page-2' }))
      )
      .mockResolvedValueOnce(jsonResponse(recordsBody({ ids: ['rec-2'] })))

    const first = await client.listRecordsPage({
      appId: 'cli_app',
      appSecret: 's3cret',
      reference: REFERENCE
    })
    expect(first.records.map((record) => record.recordId)).toEqual(['rec-1'])
    expect(first.nextPageToken).toBe('page-2')

    const second = await client.listRecordsPage({
      appId: 'cli_app',
      appSecret: 's3cret',
      reference: REFERENCE,
      pageToken: 'page-2'
    })
    expect(second.nextPageToken).toBeNull()

    const secondRecordsUrl = String(fetchMock.mock.calls[2]?.[0])
    expect(secondRecordsUrl).toContain('page_token=page-2')
  })

  it('retries once on tenant-token expiry and invalidates the cached token', async () => {
    const client = await loadClient()
    fetchMock
      .mockResolvedValueOnce(jsonResponse(tokenBody()))
      .mockResolvedValueOnce(jsonResponse({ code: 99991663, msg: 'access token expired' }))
      .mockResolvedValueOnce(
        jsonResponse({ ...tokenBody(), tenant_access_token: 'tenant-token-2' })
      )
      .mockResolvedValueOnce(jsonResponse(recordsBody({ ids: ['rec-1'] })))

    const page = await client.listRecordsPage({
      appId: 'cli_app',
      appSecret: 's3cret',
      reference: REFERENCE
    })
    expect(page.records).toHaveLength(1)
    const tokenCalls = fetchMock.mock.calls.filter(([url]) =>
      String(url).includes('/auth/v3/tenant_access_token/internal')
    )
    expect(tokenCalls).toHaveLength(2)
    const lastHeaders = fetchMock.mock.calls[3]?.[1]?.headers ?? {}
    expect(lastHeaders['Authorization']).toBe('Bearer tenant-token-2')
  })

  it('maps Feishu error envelopes to typed errors and drops malformed records', async () => {
    const client = await loadClient()
    fetchMock
      .mockResolvedValueOnce(jsonResponse(tokenBody()))
      .mockResolvedValueOnce(jsonResponse(recordsBody({ ids: ['rec-1', '', 'rec-3'] })))

    const page = await client.listRecordsPage({
      appId: 'cli_app',
      appSecret: 's3cret',
      reference: REFERENCE
    })
    expect(page.records.map((record) => record.recordId)).toEqual(['rec-1', 'rec-3'])

    fetchMock.mockResolvedValueOnce(
      jsonResponse({ code: 1254043, msg: 'base app token not found' }, 404)
    )
    await expect(
      client.getRecord({
        appId: 'cli_app',
        appSecret: 's3cret',
        reference: { connectionId: 'conn-1', ...REFERENCE, recordId: 'rec-9' }
      })
    ).rejects.toMatchObject({ name: 'FeishuBitableApiError', code: 1254043 })
  })

  it('rejects non-JSON responses as API errors', async () => {
    const client = await loadClient()
    fetchMock
      .mockResolvedValueOnce(jsonResponse(tokenBody()))
      .mockResolvedValueOnce(new Response('<html>login page</html>', { status: 502 }))

    await expect(
      client.listRecordsPage({ appId: 'cli_app', appSecret: 's3cret', reference: REFERENCE })
    ).rejects.toMatchObject({ name: 'FeishuBitableApiError' })
  })

  it('walks every fields page with a bounded loop', async () => {
    const client = await loadClient()
    fetchMock
      .mockResolvedValueOnce(jsonResponse(tokenBody()))
      .mockResolvedValueOnce(
        jsonResponse({
          code: 0,
          msg: 'ok',
          data: {
            items: [
              { field_name: '标题', type: 1, ui_type: 'text' },
              { field_name: '', type: 2 }
            ],
            has_more: true,
            page_token: 'fields-2'
          }
        })
      )
      .mockResolvedValueOnce(
        jsonResponse({
          code: 0,
          msg: 'ok',
          data: {
            items: [{ field_name: '状态', type: 3, ui_type: 'single_select' }],
            has_more: false
          }
        })
      )

    const fields = await client.listAllFields({
      appId: 'cli_app',
      appSecret: 's3cret',
      reference: REFERENCE
    })
    expect(fields.map((field) => field.fieldName)).toEqual(['标题', '状态'])
    expect(fields[0]?.uiType).toBe('text')
  })
})

it('retries an expired tenant token at most once', async () => {
  const client = await loadClient()
  const expired = { code: 99991663, msg: 'expired' }
  fetchMock
    .mockResolvedValueOnce(jsonResponse(tokenBody()))
    .mockResolvedValueOnce(jsonResponse(expired))
    .mockResolvedValueOnce(jsonResponse(tokenBody()))
    .mockResolvedValueOnce(jsonResponse(expired))
  await expect(
    client.listRecordsPage({
      appId: 'retry-app',
      appSecret: 'retry-secret',
      reference: { appToken: 'app', tableId: 'table' }
    })
  ).rejects.toThrow('expired')
  expect(fetchMock).toHaveBeenCalledTimes(4)
})
