import { describe, expect, it } from 'vitest'
import { getMarkdownBlockScales } from './mobile-markdown-scale'

describe('getMarkdownBlockScales', () => {
  it('chat mode (default) scales only paragraphs and lists, with upstream sizes', () => {
    const s = getMarkdownBlockScales(1.25)
    expect(s.prose).toEqual({ fontSize: 13 * 1.25, lineHeight: 19 * 1.25 })
    expect(s.list).toEqual({ fontSize: 14 * 1.25, lineHeight: 20 * 1.25 })
    for (const key of [
      'heading',
      'headingLarge',
      'quote',
      'codeLanguage',
      'codeText',
      'imageCaption',
      'tableCell',
      'tableTruncated',
      'listMarker'
    ] as const) {
      expect(s[key]).toBeNull()
    }
  })

  it('is a no-op at scale 1', () => {
    expect(Object.values(getMarkdownBlockScales(1))).toEqual(Array(11).fill(null))
  })

  it('viewer mode scales every block', () => {
    const s = getMarkdownBlockScales(1.5, true)
    expect(s.heading).toEqual({ fontSize: 14 * 1.5, lineHeight: 20 * 1.5 })
    expect(s.codeText).toEqual({ fontSize: 12 * 1.5, lineHeight: 17 * 1.5 })
    expect(s.list).toEqual({ fontSize: 14 * 1.5, lineHeight: 20 * 1.5 })
  })
})
