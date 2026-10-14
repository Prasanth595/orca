import { beforeEach, describe, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ records: vi.fn(), fields: vi.fn() }))
vi.mock('./client', () => ({
  listRecordsPage: mocks.records,
  listAllFields: mocks.fields,
  getRecord: vi.fn(),
  FeishuBitableApiError: Error,
  FeishuBitableAuthError: Error
}))
vi.mock('./connection-store', () => {
  const connection = {
    id: 'c',
    label: 'Board',
    appId: 'app',
    appToken: 'base',
    tableId: 'table',
    createdAt: '',
    fieldMapping: {
      titleField: 'Title',
      descriptionField: null,
      acceptanceCriteriaField: null,
      urlField: null
    }
  }
  return {
    getConnection: () => connection,
    getConnectionFile: () => ({ connections: [connection], activeConnectionId: 'c' }),
    readSecret: () => 'secret',
    getStatus: vi.fn(),
    removeConnection: vi.fn(),
    selectConnection: vi.fn(),
    updateFieldMapping: vi.fn(),
    upsertConnection: vi.fn()
  }
})
import { listRecords } from './service'
beforeEach(() => {
  mocks.records.mockReset()
  mocks.fields.mockReset()
})
describe('Feishu record column metadata', () => {
  it('returns all column definitions and unmapped values with the first record page', async () => {
    const fields = [
      { fieldName: 'Title', type: 1 },
      { fieldName: 'Empty', type: 1 },
      { fieldName: 'Status', type: 3 }
    ]
    mocks.fields.mockResolvedValue(fields)
    mocks.records.mockResolvedValue({
      records: [{ recordId: 'record', fields: { Title: 'Task', Status: 'Todo' } }],
      nextPageToken: 'next'
    })
    const result = await listRecords({})
    expect(result).toMatchObject({
      ok: true,
      page: {
        fields,
        tasks: [{ fieldValues: { Title: 'Task', Status: 'Todo' } }],
        nextPageToken: 'next'
      }
    })
    expect(mocks.fields).toHaveBeenCalledWith({
      appId: 'app',
      appSecret: 'secret',
      reference: expect.objectContaining({ tableId: 'table' }),
      signal: undefined
    })
  })
  it('does not repeat the field scan for each appended records page', async () => {
    mocks.records.mockResolvedValue({ records: [], nextPageToken: null })
    expect(await listRecords({ pageToken: 'next' })).toMatchObject({
      ok: true,
      page: { tasks: [] }
    })
    expect(mocks.fields).not.toHaveBeenCalled()
  })
  it('reports field permission failures rather than claiming every column was loaded', async () => {
    mocks.fields.mockRejectedValue(new Error('Fields access denied'))
    mocks.records.mockResolvedValue({ records: [], nextPageToken: null })
    expect(await listRecords({})).toEqual({ ok: false, error: 'Fields access denied' })
  })
})
