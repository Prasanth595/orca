import type * as FeishuClient from './client'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { FeishuBitableConnection, FeishuBitableField } from '../../shared/feishu-bitable-types'
const mocks = vi.hoisted(() => ({
  connection: vi.fn(),
  secret: vi.fn(),
  fields: vi.fn(),
  record: vi.fn(),
  request: vi.fn()
}))
vi.mock('./connection-store', () => ({ getConnection: mocks.connection, readSecret: mocks.secret }))
vi.mock('./client', async (importOriginal) => ({
  ...(await importOriginal<typeof FeishuClient>()),
  listAllFields: mocks.fields,
  getRecord: mocks.record,
  feishuRequest: mocks.request
}))
import { FeishuBitableApiError } from './client'
import { completeRecord } from './record-completion'

const reference = {
  connectionId: 'connection',
  appToken: 'base',
  tableId: 'table',
  recordId: 'record'
}
function connection(): FeishuBitableConnection {
  return {
    id: 'connection',
    appId: 'app',
    appToken: 'base',
    tableId: 'table',
    label: 'Board',
    createdAt: '',
    fieldMapping: {
      titleField: 'Title',
      descriptionField: null,
      acceptanceCriteriaField: null,
      urlField: null,
      statusField: 'Status',
      completedValue: 'Done'
    }
  }
}
beforeEach(() => {
  vi.resetAllMocks()
  mocks.connection.mockReturnValue(connection())
  mocks.secret.mockReturnValue('fixture-secret')
  mocks.fields.mockResolvedValue([{ fieldName: 'Status', type: 3, options: ['Todo', 'Done'] }])
  mocks.record.mockResolvedValue({
    recordId: 'record',
    fields: { Title: 'Task', Status: 'Todo', Notes: 'Preserve' }
  })
  mocks.request.mockResolvedValue({ record: { record_id: 'record', fields: { Status: 'Done' } } })
})
describe('explicit Feishu record completion', () => {
  it('uses only the selected host credentials and writes exactly the mapped field', async () => {
    expect(await completeRecord({ record: reference })).toMatchObject({
      ok: true,
      task: {
        record: reference,
        fieldValues: { Title: 'Task', Status: 'Done', Notes: 'Preserve' }
      }
    })
    expect(mocks.connection).toHaveBeenCalledWith('connection')
    expect(mocks.secret).toHaveBeenCalledWith('connection')
    expect(mocks.request).toHaveBeenCalledTimes(1)
    expect(mocks.request).toHaveBeenCalledWith(
      '/open-apis/bitable/v1/apps/base/tables/table/records/record',
      {
        method: 'PUT',
        auth: { appId: 'app', appSecret: 'fixture-secret' },
        json: { fields: { Status: 'Done' } }
      }
    )
  })
  it.each(['appToken', 'tableId', 'connectionId'] as const)(
    'checks full identity including %s',
    async (key) => {
      if (key === 'connectionId') {
        mocks.connection.mockReturnValue(null)
      }
      expect(await completeRecord({ record: { ...reference, [key]: 'other' } })).toMatchObject({
        ok: false
      })
      expect(mocks.request).not.toHaveBeenCalled()
      expect(mocks.secret).not.toHaveBeenCalled()
    }
  )
  it.each([null, '', undefined])(
    'requires an explicit status mapping (%s)',
    async (statusField) => {
      const c = connection()
      c.fieldMapping.statusField = statusField
      mocks.connection.mockReturnValue(c)
      expect(await completeRecord({ record: reference })).toMatchObject({
        ok: false,
        error: expect.stringContaining('Configure')
      })
      expect(mocks.fields).not.toHaveBeenCalled()
      expect(mocks.request).not.toHaveBeenCalled()
    }
  )
  it.each<FeishuBitableField[]>([
    [],
    [{ fieldName: 'Status', type: 20 }],
    [{ fieldName: 'Status', type: 3 }],
    [{ fieldName: 'Status', type: 3, options: ['Todo'] }]
  ])('never guesses missing columns, unsupported types or options (%j)', async (...fields) => {
    mocks.fields.mockResolvedValue(fields)
    expect(await completeRecord({ record: reference })).toMatchObject({ ok: false })
    expect(mocks.request).not.toHaveBeenCalled()
  })
  it('accepts an explicitly configured text value', async () => {
    mocks.fields.mockResolvedValue([{ fieldName: 'Status', type: 1 }])
    expect(await completeRecord({ record: reference })).toMatchObject({ ok: true })
  })
  it('does not write to a deleted record', async () => {
    mocks.record.mockResolvedValue(null)
    expect(await completeRecord({ record: reference })).toMatchObject({ ok: false })
    expect(mocks.request).not.toHaveBeenCalled()
  })
  it('reports write denial without changing the local record or removing read access', async () => {
    mocks.request.mockRejectedValue(new FeishuBitableApiError('Permission denied', 1254302, 403))
    expect(await completeRecord({ record: reference })).toEqual({
      ok: false,
      error:
        'The app needs record write permission and access to this status field. Reading remains available.'
    })
    expect(mocks.request).toHaveBeenCalledTimes(1)
  })
  it('does not invent completion after loss of contact or an unverifiable response', async () => {
    mocks.request.mockRejectedValueOnce(new Error('SSH contact lost'))
    expect(await completeRecord({ record: reference })).toMatchObject({ ok: false })
    mocks.request.mockResolvedValueOnce({
      record: { record_id: 'other', fields: { Status: 'Done' } }
    })
    expect(await completeRecord({ record: reference })).toMatchObject({
      ok: false,
      error: expect.stringContaining('verify')
    })
  })
})

it('requires a completion value and a stored secret without touching the write endpoint', async () => {
  const c = connection()
  c.fieldMapping.completedValue = null
  mocks.connection.mockReturnValueOnce(c)
  expect(await completeRecord({ record: reference })).toMatchObject({ ok: false })
  mocks.secret.mockReturnValueOnce(null)
  expect(await completeRecord({ record: reference })).toMatchObject({
    ok: false,
    error: expect.stringContaining('secret is missing')
  })
  expect(mocks.request).not.toHaveBeenCalled()
})
