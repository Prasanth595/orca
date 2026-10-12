import { describe, expect, it, vi } from 'vitest'

describe('editor font size floor', () => {
  it('on web, clamps the smallest preset (0.75) up to the 16px focus-zoom floor', async () => {
    vi.resetModules()
    vi.doMock('../../platform/text-input-font-size', () => ({
      TEXT_INPUT_FONT_SIZE: 16,
      TEXT_INPUT_FONT_SIZE_FLOOR: 16
    }))
    const { editorFontSizeRule, richMarkdownEditorStyle } = await import('./document-style')
    const rule = editorFontSizeRule()
    expect(rule).toBe('max(16px, calc(16px * var(--markdown-text-scale)))')
    expect(richMarkdownEditorStyle()).toContain(`font-size: ${rule};`)
    // 16 * 0.75 = 12 < 16, so the floor wins at the smallest preset.
    expect(Math.max(16, 16 * 0.75)).toBe(16)
    vi.doUnmock('../../platform/text-input-font-size')
  })

  it('on native, has no floor so the editor can shrink', async () => {
    vi.resetModules()
    const { editorFontSizeRule } = await import('./document-style')
    expect(editorFontSizeRule()).not.toContain('max(')
  })
})
