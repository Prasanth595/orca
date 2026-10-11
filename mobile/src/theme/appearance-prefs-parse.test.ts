import { describe, expect, it } from 'vitest'
import { parseAppearancePrefs } from './appearance-prefs-parse'

describe('parseAppearancePrefs', () => {
  it('falls back to defaults on garbage and unknown values', () => {
    expect(parseAppearancePrefs(null)).toEqual({
      theme: 'system',
      contrast: 'normal',
      textScale: 1
    })
    expect(parseAppearancePrefs('{nope')).toEqual({
      theme: 'system',
      contrast: 'normal',
      textScale: 1
    })
    expect(parseAppearancePrefs('{"theme":"sepia","contrast":"max","textScale":7}')).toEqual({
      theme: 'system',
      contrast: 'normal',
      textScale: 1
    })
  })

  it('keeps valid values', () => {
    expect(parseAppearancePrefs('{"theme":"light","contrast":"high","textScale":1.3}')).toEqual({
      theme: 'light',
      contrast: 'high',
      textScale: 1.3
    })
  })
})
