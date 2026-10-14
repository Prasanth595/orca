import { afterEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_PROVIDER_COLORS, resolveProviderTint } from './status-bar-provider-colors'

describe('resolveProviderTint', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('stays off unless enabled', () => {
    expect(resolveProviderTint(null, 'claude')).toBeUndefined()
    expect(
      resolveProviderTint({ statusBarProviderColors: { claude: '#ff0000' } }, 'claude')
    ).toBeUndefined()
  })

  it('falls back to the default when the custom color is not a valid CSS color', () => {
    vi.stubGlobal('CSS', { supports: (_prop: string, value: string) => value.startsWith('#') })
    const settings = {
      statusBarProviderColorsEnabled: true,
      statusBarProviderColors: { claude: 'notacolor', codex: '#123456' }
    }
    expect(resolveProviderTint(settings, 'claude')).toContain(DEFAULT_PROVIDER_COLORS.claude)
    expect(resolveProviderTint(settings, 'codex')).toContain('#123456')
  })

  it('uses the custom color, falling back to the default when blank or missing', () => {
    vi.stubGlobal('CSS', { supports: () => true })
    const settings = {
      statusBarProviderColorsEnabled: true,
      statusBarProviderColors: { claude: ' #ff0000 ', gemini: '  ' }
    }
    expect(resolveProviderTint(settings, 'claude')).toBe(
      'color-mix(in srgb, #ff0000 28%, transparent)'
    )
    expect(resolveProviderTint(settings, 'gemini')).toContain(DEFAULT_PROVIDER_COLORS.gemini)
    expect(resolveProviderTint(settings, 'codex')).toContain(DEFAULT_PROVIDER_COLORS.codex)
  })
})
