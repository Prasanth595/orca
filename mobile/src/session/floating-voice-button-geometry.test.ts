import { describe, expect, it } from 'vitest'
import {
  DEFAULT_FLOATING_VOICE_BUTTON_OPACITY_PERCENT,
  DEFAULT_FLOATING_VOICE_BUTTON_POSITION,
  DEFAULT_FLOATING_VOICE_BUTTON_SIZE_PERCENT,
  clampFloatingVoiceButtonPosition,
  denormalizeFloatingVoiceButtonPosition,
  floatingVoiceButtonDiameter,
  isFloatingVoiceButtonDragTap,
  isFloatingVoiceButtonNormalizedPosition,
  isFloatingVoiceButtonOpacityPercent,
  isFloatingVoiceButtonSizePercent,
  normalizeFloatingVoiceButtonPosition,
  resolveFloatingVoiceRelease,
  shouldAutoSendDictation
} from './floating-voice-button-geometry'

const BASE_RELEASE_PARAMS = {
  dx: 0,
  dy: 0,
  mode: 'toggle',
  disabled: false,
  heldLongEnough: false,
  active: false,
  processing: false,
  pressedIn: false,
  cancelled: false
}

describe('resolveFloatingVoiceRelease', () => {
  it('tap with zero movement resolves to tap', () => {
    expect(resolveFloatingVoiceRelease(BASE_RELEASE_PARAMS)).toBe('tap')
  })

  it('hold mode stationary release resolves to pressOut', () => {
    expect(
      resolveFloatingVoiceRelease({ ...BASE_RELEASE_PARAMS, mode: 'hold', pressedIn: true })
    ).toBe('pressOut')
  })

  it('hold mode drag release cancels the dictation instead of stopping it', () => {
    expect(
      resolveFloatingVoiceRelease({ ...BASE_RELEASE_PARAMS, mode: 'hold', pressedIn: true, dx: 30 })
    ).toBe('cancel')
  })

  it('hold mode pressOut fires whenever pressIn ran, even if disabled flipped mid-hold', () => {
    expect(
      resolveFloatingVoiceRelease({
        ...BASE_RELEASE_PARAMS,
        mode: 'hold',
        pressedIn: true,
        disabled: true
      })
    ).toBe('pressOut')
  })

  it('hold mode with no pressIn (disabled at touch-down) does nothing', () => {
    expect(
      resolveFloatingVoiceRelease({ ...BASE_RELEASE_PARAMS, mode: 'hold', disabled: true })
    ).toBe('none')
  })

  it('toggle tap that never activated the Pan (success:false) still resolves to tap', () => {
    expect(resolveFloatingVoiceRelease({ ...BASE_RELEASE_PARAMS })).toBe('tap')
  })

  it('hold stationary release that never activated the Pan (success:false) resolves to pressOut', () => {
    expect(
      resolveFloatingVoiceRelease({ ...BASE_RELEASE_PARAMS, mode: 'hold', pressedIn: true })
    ).toBe('pressOut')
  })

  it('touches cancelled cancels a hold dictation', () => {
    expect(
      resolveFloatingVoiceRelease({
        ...BASE_RELEASE_PARAMS,
        mode: 'hold',
        pressedIn: true,
        cancelled: true
      })
    ).toBe('cancel')
  })

  it('touches cancelled in toggle mode does not toggle', () => {
    expect(resolveFloatingVoiceRelease({ ...BASE_RELEASE_PARAMS, cancelled: true })).toBe('none')
  })

  it('movement past the drag threshold resolves to drag', () => {
    expect(resolveFloatingVoiceRelease({ ...BASE_RELEASE_PARAMS, dx: 20 })).toBe('drag')
  })

  it('disabled tap resolves to no action', () => {
    expect(resolveFloatingVoiceRelease({ ...BASE_RELEASE_PARAMS, disabled: true })).toBe('none')
  })

  it('a long-held tap while active cancels instead of toggling', () => {
    expect(
      resolveFloatingVoiceRelease({
        ...BASE_RELEASE_PARAMS,
        heldLongEnough: true,
        active: true
      })
    ).toBe('cancel')
  })

  it('a long-held tap while processing cancels too', () => {
    expect(
      resolveFloatingVoiceRelease({
        ...BASE_RELEASE_PARAMS,
        heldLongEnough: true,
        processing: true
      })
    ).toBe('cancel')
  })

  it('a long-held tap while idle is a plain tap, not a cancel', () => {
    expect(resolveFloatingVoiceRelease({ ...BASE_RELEASE_PARAMS, heldLongEnough: true })).toBe(
      'tap'
    )
  })
})

describe('shouldAutoSendDictation', () => {
  it('sends when enabled and the transcript has content', () => {
    expect(shouldAutoSendDictation(true, 'deploy the app')).toBe(true)
  })

  it('never sends when the setting is off', () => {
    expect(shouldAutoSendDictation(false, 'deploy the app')).toBe(false)
  })

  it('never sends empty or whitespace-only text', () => {
    expect(shouldAutoSendDictation(true, '')).toBe(false)
    expect(shouldAutoSendDictation(true, '   ')).toBe(false)
  })
})

const INSETS = { top: 10, bottom: 20, left: 0, right: 0 }

describe('floatingVoiceButtonDiameter', () => {
  it('scales the inline button size by percent', () => {
    expect(floatingVoiceButtonDiameter(100)).toBe(34)
    expect(floatingVoiceButtonDiameter(DEFAULT_FLOATING_VOICE_BUTTON_SIZE_PERCENT)).toBe(68)
    expect(floatingVoiceButtonDiameter(50)).toBe(17)
  })
})

describe('isFloatingVoiceButtonSizePercent', () => {
  it('accepts only the discrete picker steps', () => {
    expect(isFloatingVoiceButtonSizePercent(200)).toBe(true)
    expect(isFloatingVoiceButtonSizePercent(50)).toBe(true)
    expect(isFloatingVoiceButtonSizePercent(300)).toBe(true)
    expect(isFloatingVoiceButtonSizePercent(60)).toBe(false)
    expect(isFloatingVoiceButtonSizePercent('200')).toBe(false)
    expect(isFloatingVoiceButtonSizePercent(undefined)).toBe(false)
  })
})

describe('isFloatingVoiceButtonOpacityPercent', () => {
  it('accepts only the discrete picker steps', () => {
    expect(isFloatingVoiceButtonOpacityPercent(DEFAULT_FLOATING_VOICE_BUTTON_OPACITY_PERCENT)).toBe(
      true
    )
    expect(isFloatingVoiceButtonOpacityPercent(5)).toBe(true)
    expect(isFloatingVoiceButtonOpacityPercent(10)).toBe(true)
    expect(isFloatingVoiceButtonOpacityPercent(25)).toBe(true)
    expect(isFloatingVoiceButtonOpacityPercent(50)).toBe(true)
    expect(isFloatingVoiceButtonOpacityPercent(75)).toBe(true)
    expect(isFloatingVoiceButtonOpacityPercent(0)).toBe(false)
    expect(isFloatingVoiceButtonOpacityPercent(60)).toBe(false)
    expect(isFloatingVoiceButtonOpacityPercent(101)).toBe(false)
    expect(isFloatingVoiceButtonOpacityPercent('100')).toBe(false)
    expect(isFloatingVoiceButtonOpacityPercent(undefined)).toBe(false)
    expect(isFloatingVoiceButtonOpacityPercent(null)).toBe(false)
  })
})

describe('clampFloatingVoiceButtonPosition', () => {
  it('leaves an in-bounds position untouched', () => {
    const result = clampFloatingVoiceButtonPosition({
      x: 100,
      y: 200,
      diameter: 68,
      containerWidth: 400,
      containerHeight: 800,
      insets: INSETS
    })
    expect(result).toEqual({ x: 100, y: 200 })
  })

  it('clamps past the right/bottom edge, respecting insets and diameter', () => {
    const result = clampFloatingVoiceButtonPosition({
      x: 10_000,
      y: 10_000,
      diameter: 68,
      containerWidth: 400,
      containerHeight: 800,
      insets: INSETS
    })
    expect(result).toEqual({ x: 400 - 8 - 68, y: 800 - 20 - 8 - 68 })
  })

  it('clamps past the top/left edge to the inset corner', () => {
    const result = clampFloatingVoiceButtonPosition({
      x: -500,
      y: -500,
      diameter: 68,
      containerWidth: 400,
      containerHeight: 800,
      insets: INSETS
    })
    expect(result).toEqual({ x: 8, y: 18 })
  })

  it('never produces a max below min on a container smaller than the button', () => {
    const result = clampFloatingVoiceButtonPosition({
      x: 50,
      y: 50,
      diameter: 300,
      containerWidth: 100,
      containerHeight: 100,
      insets: INSETS
    })
    expect(result.x).toBe(8)
    expect(result.y).toBe(18)
  })

  it('falls back to the min corner for a non-finite position', () => {
    const result = clampFloatingVoiceButtonPosition({
      x: Number.NaN,
      y: Number.POSITIVE_INFINITY,
      diameter: 68,
      containerWidth: 400,
      containerHeight: 800,
      insets: INSETS
    })
    expect(result).toEqual({ x: 8, y: 18 })
  })
})

describe('normalize/denormalize round trip', () => {
  it('recovers a clamped position after a container resize (rotation)', () => {
    const normalized = normalizeFloatingVoiceButtonPosition({
      x: 350,
      y: 700,
      containerWidth: 400,
      containerHeight: 800
    })
    // Rotate: container is now wider than tall.
    const rotated = denormalizeFloatingVoiceButtonPosition({
      position: normalized,
      diameter: 68,
      containerWidth: 800,
      containerHeight: 400,
      insets: INSETS
    })
    expect(rotated.x).toBeCloseTo(700)
    expect(rotated.y).toBeLessThanOrEqual(400 - INSETS.bottom - 68)
  })

  it('the documented default position clamps to a valid on-screen spot', () => {
    const pos = denormalizeFloatingVoiceButtonPosition({
      position: DEFAULT_FLOATING_VOICE_BUTTON_POSITION,
      diameter: 68,
      containerWidth: 390,
      containerHeight: 844,
      insets: { top: 47, bottom: 34, left: 0, right: 0 }
    })
    expect(pos.x).toBeGreaterThanOrEqual(0)
    expect(pos.x).toBeLessThanOrEqual(390 - 68)
    expect(pos.y).toBeGreaterThanOrEqual(47)
    expect(pos.y).toBeLessThanOrEqual(844 - 34 - 68)
  })
})

describe('isFloatingVoiceButtonNormalizedPosition', () => {
  it('validates shape and range', () => {
    expect(isFloatingVoiceButtonNormalizedPosition({ xFrac: 0.5, yFrac: 0.5 })).toBe(true)
    expect(isFloatingVoiceButtonNormalizedPosition({ xFrac: 1, yFrac: 0 })).toBe(true)
    expect(isFloatingVoiceButtonNormalizedPosition({ xFrac: 1.5, yFrac: 0 })).toBe(false)
    expect(isFloatingVoiceButtonNormalizedPosition({ xFrac: -0.1, yFrac: 0 })).toBe(false)
    expect(isFloatingVoiceButtonNormalizedPosition({ xFrac: '0.5', yFrac: 0.5 })).toBe(false)
    expect(isFloatingVoiceButtonNormalizedPosition(null)).toBe(false)
    expect(isFloatingVoiceButtonNormalizedPosition(undefined)).toBe(false)
  })
})

describe('isFloatingVoiceButtonDragTap', () => {
  it('treats sub-threshold movement as a tap', () => {
    expect(isFloatingVoiceButtonDragTap(0, 0)).toBe(true)
    expect(isFloatingVoiceButtonDragTap(5, 5)).toBe(true)
    expect(isFloatingVoiceButtonDragTap(-8, 2)).toBe(true)
  })

  it('treats movement past the threshold as a drag', () => {
    expect(isFloatingVoiceButtonDragTap(20, 0)).toBe(false)
    expect(isFloatingVoiceButtonDragTap(0, -30)).toBe(false)
    expect(isFloatingVoiceButtonDragTap(9, 9)).toBe(false) // hypot ≈ 12.7
  })
})
