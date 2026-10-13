import { describe, expect, it } from 'vitest'
import {
  feishuBitableRecordKey,
  isSameFeishuBitableRecord,
  normalizeFeishuBitableFieldMapping,
  normalizeFeishuBitableRecordReference,
  parseFeishuBitableConnectionStatus
} from './feishu-bitable-types'

const FULL_REFERENCE = {
  connectionId: 'conn-1',
  appToken: 'app-token-a',
  tableId: 'tbl-alpha',
  recordId: 'rec-0001'
}

describe('feishuBitableRecordKey', () => {
  it('keys the full connection/app/table/record tuple', () => {
    const key = feishuBitableRecordKey(FULL_REFERENCE)
    expect(key).toBe(JSON.stringify(['conn-1', 'app-token-a', 'tbl-alpha', 'rec-0001']))
  })

  it('separates records that differ in only one tuple part', () => {
    expect(feishuBitableRecordKey(FULL_REFERENCE)).not.toBe(
      feishuBitableRecordKey({ ...FULL_REFERENCE, recordId: 'rec-0002' })
    )
    expect(feishuBitableRecordKey(FULL_REFERENCE)).not.toBe(
      feishuBitableRecordKey({ ...FULL_REFERENCE, tableId: 'tbl-beta' })
    )
  })

  it('treats null references as equal only to each other', () => {
    expect(isSameFeishuBitableRecord(null, undefined)).toBe(true)
    expect(isSameFeishuBitableRecord(FULL_REFERENCE, null)).toBe(false)
  })
})

describe('normalizeFeishuBitableRecordReference', () => {
  it('accepts the complete tuple with trimmed parts', () => {
    expect(
      normalizeFeishuBitableRecordReference({
        connectionId: ' conn-1 ',
        appToken: 'app-token-a',
        tableId: 'tbl-alpha',
        recordId: 'rec-0001'
      })
    ).toEqual(FULL_REFERENCE)
  })

  it('rejects a record missing any tuple part, or a numeric placeholder', () => {
    expect(normalizeFeishuBitableRecordReference({ ...FULL_REFERENCE, recordId: '' })).toBeNull()
    expect(normalizeFeishuBitableRecordReference({ ...FULL_REFERENCE, appToken: 7 })).toBeNull()
    expect(normalizeFeishuBitableRecordReference('rec-0001')).toBeNull()
    expect(normalizeFeishuBitableRecordReference(null)).toBeNull()
  })
})

describe('normalizeFeishuBitableFieldMapping', () => {
  it('trims slot names and drops blanks to null', () => {
    expect(
      normalizeFeishuBitableFieldMapping({
        titleField: ' 标题 ',
        descriptionField: '',
        acceptanceCriteriaField: '   ',
        urlField: '链接'
      })
    ).toEqual({
      titleField: '标题',
      descriptionField: null,
      acceptanceCriteriaField: null,
      urlField: '链接'
    })
  })

  it('returns an all-null mapping for non-object input', () => {
    expect(normalizeFeishuBitableFieldMapping('title')).toEqual({
      titleField: null,
      descriptionField: null,
      acceptanceCriteriaField: null,
      urlField: null
    })
  })
})

describe('parseFeishuBitableConnectionStatus', () => {
  it('drops malformed connections and repairs a dangling active id', () => {
    const status = parseFeishuBitableConnectionStatus({
      connected: true,
      activeConnectionId: 'missing',
      connections: [
        {
          id: 'conn-1',
          label: 'Team board',
          appId: 'cli_app',
          appToken: 'app-token-a',
          tableId: 'tbl-alpha',
          fieldMapping: { titleField: '标题' },
          createdAt: '2026-01-01T00:00:00.000Z'
        },
        { id: '', label: 'broken' }
      ],
      credentialProtection: 'sealed'
    })
    expect(status.connected).toBe(true)
    expect(status.connections).toHaveLength(1)
    // A dangling active id falls back to the first surviving connection.
    expect(status.activeConnectionId).toBe('conn-1')
    expect(status.connections[0]?.fieldMapping.titleField).toBe('标题')
    expect(status.credentialProtection).toBe('sealed')
  })

  it('never reports connected without surviving connections', () => {
    const status = parseFeishuBitableConnectionStatus({
      connected: true,
      connections: 'nope'
    })
    expect(status.connected).toBe(false)
    expect(status.activeConnectionId).toBeNull()
    expect(status.credentialError).toBeUndefined()
  })
})
