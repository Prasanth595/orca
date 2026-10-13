import { describe, expect, it } from 'vitest'

import zhHant from './locales/zh-Hant.json'

// Why: only characters that never appear in Traditional text; shared ones (行, 置, 框) would false-positive.
const SIMPLIFIED_ONLY_CHARACTERS = new Set(
  '们这说为个时开关闭设执运务环当发选择项创删复员终输显进对话档读写载线种网络页键错误动态库储'
)

function collectStrings(node: unknown, path: string, out: [string, string][]): void {
  if (typeof node === 'string') {
    out.push([path, node])
    return
  }
  if (node && typeof node === 'object') {
    for (const [key, value] of Object.entries(node)) {
      collectStrings(value, path ? `${path}.${key}` : key, out)
    }
  }
}

describe('zh-Hant catalog', () => {
  it('contains no Simplified-only characters', () => {
    const entries: [string, string][] = []
    collectStrings(zhHant, '', entries)
    const leaks = entries.filter(([, value]) =>
      [...value].some((char) => SIMPLIFIED_ONLY_CHARACTERS.has(char))
    )
    expect(leaks.map(([path]) => path)).toEqual([])
  })

  // Why: these are mainland terms (often left by s2t conversion); Taiwan UI copy uses 電腦, 分頁, 雲端, 工作階段, etc.
  it('uses Taiwan terms instead of mainland ones', () => {
    const entries: [string, string][] = []
    collectStrings(zhHant, '', entries)
    expect(
      entries
        .filter(([, value]) =>
          /計算機|製表符|云|雲(?!端)|會話|獲取|構建|令牌|拉取請求|選項卡|標籤頁|本地|倉庫|後臺|影象|單擊|當前|自定義|二維碼|反饋|終端(?!機)|許可權|擴充套件|谷歌|開放伊|烤肉串|亞搏/.test(
            value
          )
        )
        .map(([path]) => path)
    ).toEqual([])
  })

  it('keeps the Simplified Chinese option in its own script', () => {
    expect(zhHant.settings.appearance.language.chinese).toBe('中文（简体）')
    expect(zhHant.settings.appearance.language.chineseTraditional).toBe('中文（繁體）')
  })
})
