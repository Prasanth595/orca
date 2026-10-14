import { describe, expect, it } from 'vitest'
import type { FeishuBitableConnection } from '../../shared/feishu-bitable-types'
import { buildRecordUrl, mapRecordToTask } from './record-tasks'
import type { RawFeishuBitableRecord } from './client'

const CONNECTION: FeishuBitableConnection = {
  id: 'conn-1',
  label: 'Team board',
  appId: 'cli_app',
  appToken: 'app-token-a',
  tableId: 'tbl-alpha',
  viewId: null,
  fieldMapping: {
    titleField: '标题',
    descriptionField: '描述',
    acceptanceCriteriaField: '验收',
    urlField: '链接'
  },
  createdAt: '2026-01-01T00:00:00.000Z',
  lastValidatedAt: null
}

function recordWith(fields: Record<string, unknown>): RawFeishuBitableRecord {
  return { recordId: 'rec-0001', fields, lastModifiedTime: '2026-02-03T04:05:06.000Z' }
}

describe('mapRecordToTask', () => {
  it('flattens untrusted Feishu field shapes into task slots', () => {
    const task = mapRecordToTask({
      connection: CONNECTION,
      record: recordWith({
        标题: [{ text: 'Fix login' }, { text: ' flow' }],
        描述: { text: 'Users cannot log in' },
        验收: [{ name: 'login works' }],
        链接: [{ link: 'https://example.com/issue/1', text: 'issue' }]
      })
    })
    expect(task.title).toBe('Fix login flow')
    expect(task.description).toBe('Users cannot log in')
    expect(task.acceptanceCriteria).toBe('login works')
    expect(task.url).toBe('https://example.com/issue/1')
  })

  it('strips control characters and numeric scalars stringify safely', () => {
    const task = mapRecordToTask({
      connection: CONNECTION,
      record: recordWith({
        标题: [42, { text: ' tasks\u0007due' }],
        描述: true
      })
    })
    expect(task.title).toBe('42 tasks due')
    expect(task.description).toBe('true')
  })

  it('preserves unmapped columns including numbers, checkbox values and structured fields', () => {
    const task = mapRecordToTask({
      connection: CONNECTION,
      record: recordWith({
        标题: [{ text: 'Fix' }, { text: ' login' }],
        负责人: [{ name: 'Alice' }, { name: 'Bob' }],
        标签: ['Bug', 'Urgent'],
        分数: 0,
        完成: false,
        公式: { value: 42 },
        附件: [{ name: 'report.pdf', file_token: 'attachment-token' }],
        其他: { custom: 'value' },
        空列: null
      })
    })
    expect(task.fieldValues).toEqual({
      标题: 'Fix login',
      负责人: 'Alice, Bob',
      标签: 'Bug, Urgent',
      分数: '0',
      完成: 'false',
      公式: '42',
      附件: 'report.pdf',
      其他: '{"custom":"value"}',
      空列: ''
    })
    expect(task.record.recordId).toBe('rec-0001')
  })

  it('caps runaway text length', () => {
    const task = mapRecordToTask({
      connection: CONNECTION,
      record: recordWith({ 标题: 'x'.repeat(50_000) })
    })
    expect(task.title.length).toBe(20_000)
  })

  it('rejects non-http url shapes and falls back to the record url', () => {
    const task = mapRecordToTask({
      connection: CONNECTION,
      record: recordWith({
        链接: [{ link: 'javascript:alert(1)' }]
      })
    })
    expect(task.url).toBe(
      buildRecordUrl({
        appToken: CONNECTION.appToken,
        tableId: CONNECTION.tableId,
        recordId: 'rec-0001'
      })
    )
  })

  it('strips embedded credentials from a mapped url', () => {
    const task = mapRecordToTask({
      connection: CONNECTION,
      record: recordWith({
        链接: [{ link: 'https://user:pass@example.com/board' }]
      })
    })
    expect(task.url).toBe('https://example.com/board')
  })

  it('uses a display-only fallback title without touching record identity', () => {
    const task = mapRecordToTask({
      connection: CONNECTION,
      record: recordWith({})
    })
    expect(task.title).toBe('Feishu record rec-0001')
    expect(task.record).toEqual({
      connectionId: 'conn-1',
      appToken: 'app-token-a',
      tableId: 'tbl-alpha',
      recordId: 'rec-0001'
    })
    expect(task.source).toEqual(task.record)
  })

  it('omits acceptance criteria when the slot is unmapped or empty', () => {
    const task = mapRecordToTask({
      connection: {
        ...CONNECTION,
        fieldMapping: { ...CONNECTION.fieldMapping, acceptanceCriteriaField: null }
      },
      record: recordWith({ 验收: 'done when green' })
    })
    expect(task.acceptanceCriteria).toBeUndefined()
  })
})

describe('buildRecordUrl', () => {
  it('encodes every tuple part', () => {
    expect(buildRecordUrl({ appToken: 'a b', tableId: 't/c', recordId: 'r?x' })).toBe(
      'https://open.feishu.cn/base/a%20b?table=t%2Fc&record=r%3Fx'
    )
  })
})
