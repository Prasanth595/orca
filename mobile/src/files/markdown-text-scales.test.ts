import { describe, expect, it } from 'vitest'
import {
  clampMarkdownTextScale,
  MARKDOWN_TEXT_SCALE_MAX,
  MARKDOWN_TEXT_SCALE_MIN,
  MARKDOWN_TEXT_SCALES,
  quantizeLiveScale,
  snapMarkdownTextScale
} from './markdown-text-scales'

describe('clampMarkdownTextScale', () => {
  it('clamps below the minimum', () => {
    expect(clampMarkdownTextScale(0.1)).toBe(MARKDOWN_TEXT_SCALE_MIN)
  })

  it('clamps above the maximum', () => {
    expect(clampMarkdownTextScale(5)).toBe(MARKDOWN_TEXT_SCALE_MAX)
  })

  it('passes through an in-range value', () => {
    expect(clampMarkdownTextScale(1.3)).toBe(1.3)
  })

  it('falls back to 1 for NaN', () => {
    expect(clampMarkdownTextScale(Number.NaN)).toBe(1)
  })
})

describe('snapMarkdownTextScale', () => {
  it('snaps to the nearest preset', () => {
    expect(snapMarkdownTextScale(1.1)).toBe(1)
    expect(snapMarkdownTextScale(1.2)).toBe(1.25)
  })

  it('snaps every preset to itself', () => {
    for (const preset of MARKDOWN_TEXT_SCALES) {
      expect(snapMarkdownTextScale(preset)).toBe(preset)
    }
  })

  it('clamps out-of-range values before snapping', () => {
    expect(snapMarkdownTextScale(10)).toBe(MARKDOWN_TEXT_SCALE_MAX)
    expect(snapMarkdownTextScale(-1)).toBe(MARKDOWN_TEXT_SCALE_MIN)
  })
})

describe('quantizeLiveScale', () => {
  it('rounds to 0.05 steps', () => {
    expect(quantizeLiveScale(1.24)).toBe(1.25)
    expect(quantizeLiveScale(1.01)).toBe(1)
  })
})
