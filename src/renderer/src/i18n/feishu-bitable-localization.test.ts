import { afterEach, describe, expect, it } from 'vitest'
import en from './locales/en.json'
import zh from './locales/zh.json'
import { i18n, setRendererUiLanguage, translate } from './i18n'
import { formatFeishuBitableError } from '@/lib/feishu-bitable-error-copy'

function flatten(
  value: unknown,
  prefix = '',
  result = new Map<string, string>()
): Map<string, string> {
  if (typeof value === 'string') {
    result.set(prefix, value)
  } else if (value && typeof value === 'object') {
    for (const [key, child] of Object.entries(value)) {
      flatten(child, prefix ? `${prefix}.${key}` : key, result)
    }
  }
  return result
}
afterEach(() => setRendererUiLanguage('en'))
describe('Feishu UI localization', () => {
  it('covers every Feishu message with real Chinese text and matching interpolation variables', () => {
    const chinese = flatten(zh)
    const english = [...flatten(en)].filter(([key]) => /feishu/i.test(key))
    expect(english.length).toBeGreaterThan(100)
    for (const [key, text] of english) {
      const translated = chinese.get(key)
      expect(translated, key).toBeDefined()
      expect(translated, key).toMatch(/\p{Script=Han}/u)
      expect(translated?.match(/{{\w+}}/g)?.sort() ?? [], key).toEqual(
        text.match(/{{\w+}}/g)?.sort() ?? []
      )
    }
  })
  it('loads Simplified Chinese in the real runtime, including old-host and write-denial errors', async () => {
    await setRendererUiLanguage('zh')
    expect(i18n.language).toBe('zh')
    expect(translate('feishu.completion.action', 'Mark complete')).toBe('标记完成')
    expect(translate('feishu.rows.details', 'View record: {{title}}', { title: '原始名称' })).toBe(
      '查看记录：原始名称'
    )
    expect(formatFeishuBitableError(new Error('Update Orca on the remote host first.'))).toContain(
      '远端主机'
    )
    expect(
      formatFeishuBitableError(
        'The app needs record write permission and access to this status field. Reading remains available.'
      )
    ).toContain('读取功能仍可使用')
    expect(translate('auto.components.feishuBitable.connect.loadTables', 'Load data tables')).toBe(
      '加载数据表'
    )
  })
  it('does not surface arbitrary error payloads or credentials in UI errors', () => {
    expect(formatFeishuBitableError(new Error('fixture-secret=hidden'))).not.toContain(
      'fixture-secret'
    )
  })
})
