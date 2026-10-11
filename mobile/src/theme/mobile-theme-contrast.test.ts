import { describe, expect, it } from 'vitest'
import {
  darkColors,
  highContrastDarkColors,
  highContrastLightColors,
  lightColors
} from './mobile-theme'

function channelLuminance(channel: number): number {
  const value = channel / 255
  return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4
}

function relativeLuminance(hex: string): number {
  const red = Number.parseInt(hex.slice(1, 3), 16)
  const green = Number.parseInt(hex.slice(3, 5), 16)
  const blue = Number.parseInt(hex.slice(5, 7), 16)
  return (
    0.2126 * channelLuminance(red) +
    0.7152 * channelLuminance(green) +
    0.0722 * channelLuminance(blue)
  )
}

function contrastRatio(foreground: string, background: string): number {
  const lighter = Math.max(relativeLuminance(foreground), relativeLuminance(background))
  const darker = Math.min(relativeLuminance(foreground), relativeLuminance(background))
  return (lighter + 0.05) / (darker + 0.05)
}

describe.each([
  ['dark', darkColors],
  ['light', lightColors],
  ['high-contrast light', highContrastLightColors],
  ['high-contrast dark', highContrastDarkColors]
] as const)('mobile text contrast (%s)', (_name, colors) => {
  it('keeps muted text readable on every standard surface', () => {
    for (const surface of [colors.bgBase, colors.bgPanel, colors.bgRaised]) {
      expect(contrastRatio(colors.textMuted, surface)).toBeGreaterThanOrEqual(4.5)
    }
  })

  it('keeps secondary text more prominent than muted text', () => {
    expect(contrastRatio(colors.textSecondary, colors.bgPanel)).toBeGreaterThan(
      contrastRatio(colors.textMuted, colors.bgPanel)
    )
  })

  it('keeps status colours readable on the base surface', () => {
    for (const status of [colors.statusGreen, colors.statusRed, colors.accentBlue]) {
      expect(contrastRatio(status, colors.bgBase)).toBeGreaterThanOrEqual(3)
    }
  })
})

// High-contrast palettes are excluded: their buttons are outline-only, so labels never sit on the fill.
describe('filled button labels (light)', () => {
  const colors = lightColors
  it('keeps label text readable on filled accent and merge buttons', () => {
    expect(contrastRatio(colors.onAccent, colors.accentBlue)).toBeGreaterThanOrEqual(4.5)
    // Merge CTA label is bold/large text, so 3:1 (WCAG large-text AA) — same bar the dark palette meets.
    expect(contrastRatio(colors.onMergeGreen, colors.mergeGreen)).toBeGreaterThanOrEqual(3)
  })
})

describe('high contrast', () => {
  it('uses exact 16-level greyscale steps for every neutral surface, border and text', () => {
    for (const palette of [highContrastLightColors, highContrastDarkColors]) {
      const neutrals = [
        palette.bgBase,
        palette.bgPanel,
        palette.bgRaised,
        palette.borderSubtle,
        palette.textPrimary,
        palette.textSecondary,
        palette.textMuted
      ]
      for (const hex of neutrals) {
        expect(hex).toMatch(/^#([0-9a-f])\1{5}$/)
      }
    }
  })

  it('keeps borders clearly visible on the base surface', () => {
    for (const palette of [highContrastLightColors, highContrastDarkColors]) {
      expect(contrastRatio(palette.borderSubtle, palette.bgBase)).toBeGreaterThanOrEqual(7)
    }
  })
})

describe('onFill', () => {
  it('equals bgBase in the plain dark and light palettes, so their labels are unchanged', () => {
    expect(darkColors.onFill).toBe(darkColors.bgBase)
    expect(lightColors.onFill).toBe(lightColors.bgBase)
  })
})
