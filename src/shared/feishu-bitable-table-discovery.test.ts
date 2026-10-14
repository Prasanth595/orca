import { describe, expect, it } from 'vitest'
import { parseFeishuBitableBase } from './feishu-bitable-table-discovery'

describe('parseFeishuBitableBase', () => {
  it('accepts a copied base link without a table parameter', () => {
    expect(
      parseFeishuBitableBase(
        'https://tiancepower.feishu.cn/base/BL0mbMJGOaFk9QsLMmhckw83nhh?from=from_copylink'
      )
    ).toEqual({ appToken: 'BL0mbMJGOaFk9QsLMmhckw83nhh', tableId: undefined })
  })
  it('preserves an explicit table and accepts a bare token', () => {
    expect(
      parseFeishuBitableBase('https://team.feishu.cn/base/base123?table=tbl123&view=view123')
    ).toEqual({ appToken: 'base123', tableId: 'tbl123' })
    expect(parseFeishuBitableBase(' base123 ')).toEqual({ appToken: 'base123' })
  })
  it.each([
    '',
    'https://example.com/base/token',
    'https://team.feishu.cn/wiki/token',
    'https://feishu.cn.evil.com/base/token',
    'http://team.feishu.cn/base/token'
  ])('rejects unsupported input %s', (value) => {
    expect(() => parseFeishuBitableBase(value)).toThrow()
  })
})
