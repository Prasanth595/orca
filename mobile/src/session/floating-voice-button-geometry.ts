// Pure geometry/logic for the floating voice button: size options, position
// normalization/clamping, and drag-vs-tap detection. No RN imports so this is
// plain-Vitest testable without mocking gesture-handler or reanimated.

/** Diameter of the inline mic button it replaces (MobileTerminalInputActions'
 *  `dictationButton` style) — the floating button's 100% size reference. */
export const INLINE_MIC_BUTTON_SIZE_PX = 34

export const FLOATING_VOICE_BUTTON_SIZE_OPTIONS = [50, 75, 100, 150, 200, 250, 300] as const

export type FloatingVoiceButtonSizePercent = (typeof FLOATING_VOICE_BUTTON_SIZE_OPTIONS)[number]

export const DEFAULT_FLOATING_VOICE_BUTTON_SIZE_PERCENT: FloatingVoiceButtonSizePercent = 200

export function isFloatingVoiceButtonSizePercent(
  value: unknown
): value is FloatingVoiceButtonSizePercent {
  return (
    typeof value === 'number' &&
    FLOATING_VOICE_BUTTON_SIZE_OPTIONS.some((option) => option === value)
  )
}

/** Diameter in px for a given size percent (50-300% of the inline button). */
export function floatingVoiceButtonDiameter(percent: number): number {
  return Math.round((INLINE_MIC_BUTTON_SIZE_PX * percent) / 100)
}

export const FLOATING_VOICE_BUTTON_OPACITY_OPTIONS = [5, 10, 25, 50, 75, 100] as const

export type FloatingVoiceButtonOpacityPercent =
  (typeof FLOATING_VOICE_BUTTON_OPACITY_OPTIONS)[number]

export const DEFAULT_FLOATING_VOICE_BUTTON_OPACITY_PERCENT: FloatingVoiceButtonOpacityPercent = 100

export function isFloatingVoiceButtonOpacityPercent(
  value: unknown
): value is FloatingVoiceButtonOpacityPercent {
  return (
    typeof value === 'number' &&
    FLOATING_VOICE_BUTTON_OPACITY_OPTIONS.some((option) => option === value)
  )
}

// Movement of at least this many px is a drag; below it, a tap/hold-press (also applied on non-activated releases).
export const FLOATING_VOICE_BUTTON_DRAG_THRESHOLD_PX = 12

export function isFloatingVoiceButtonDragTap(dx: number, dy: number): boolean {
  return Math.hypot(dx, dy) < FLOATING_VOICE_BUTTON_DRAG_THRESHOLD_PX
}

/** What a Pan gesture's release should do, decoupled from RNGH's onEnd/onFinalize split.
 *  RNGH's finalize `success` is NOT used: a stationary tap never activates the Pan, so it
 *  finalizes as FAILED (success=false) yet is a normal release decided by distance. A real
 *  system cancel is detected separately (onTouchesCancelled) and passed as `cancelled`.
 *  Hold mode: a drag or cancelled touch CANCELS the dictation (nothing transcribed or sent);
 *  otherwise pressOut. It keys on `pressedIn`, not `disabled`, so a recording can always stop. */
export type FloatingVoiceReleaseAction = 'tap' | 'cancel' | 'drag' | 'pressOut' | 'none'

export function resolveFloatingVoiceRelease(params: {
  dx: number
  dy: number
  mode: string | undefined
  disabled: boolean
  heldLongEnough: boolean
  active: boolean
  processing: boolean
  /** Hold mode: whether onBegin already called pressIn for this touch. */
  pressedIn: boolean
  /** The system took the touch (onTouchesCancelled). Not RNGH's finalize `success`. */
  cancelled: boolean
}): FloatingVoiceReleaseAction {
  const dragged = !isFloatingVoiceButtonDragTap(params.dx, params.dy)
  if (params.mode === 'hold') {
    if (!params.pressedIn) {
      return dragged ? 'drag' : 'none'
    }
    return dragged || params.cancelled ? 'cancel' : 'pressOut'
  }
  if (dragged) {
    return 'drag'
  }
  if (params.disabled || params.cancelled) {
    return 'none'
  }
  return params.heldLongEnough && (params.active || params.processing) ? 'cancel' : 'tap'
}

/** Whether a finished (non-cancelled) dictation transcript should be submitted
 *  immediately, as if the user pressed Send. */
export function shouldAutoSendDictation(autoSendEnabled: boolean, transcript: string): boolean {
  return autoSendEnabled && transcript.trim().length > 0
}

export type FloatingVoiceButtonInsets = {
  readonly top: number
  readonly bottom: number
  readonly left: number
  readonly right: number
}

export type FloatingVoiceButtonPoint = {
  readonly x: number
  readonly y: number
}

export const FLOATING_VOICE_BUTTON_EDGE_MARGIN = 8

/** Clamps a top-left px position so the button (given `diameter`) stays fully
 *  inside the container and clear of the safe area on every edge. Falls back
 *  to the top-left safe corner when the container is too small to fit it. */
export function clampFloatingVoiceButtonPosition(params: {
  x: number
  y: number
  diameter: number
  containerWidth: number
  containerHeight: number
  insets: FloatingVoiceButtonInsets
}): FloatingVoiceButtonPoint {
  const { diameter, containerWidth, containerHeight, insets } = params
  // Why a margin: flush against the edge the circle's border is cut by the screen edge.
  const minX = insets.left + FLOATING_VOICE_BUTTON_EDGE_MARGIN
  const minY = insets.top + FLOATING_VOICE_BUTTON_EDGE_MARGIN
  const maxX = Math.max(
    minX,
    containerWidth - insets.right - FLOATING_VOICE_BUTTON_EDGE_MARGIN - diameter
  )
  const maxY = Math.max(
    minY,
    containerHeight - insets.bottom - FLOATING_VOICE_BUTTON_EDGE_MARGIN - diameter
  )
  return {
    x: clamp(params.x, minX, maxX),
    y: clamp(params.y, minY, maxY)
  }
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) {
    return min
  }
  return Math.min(max, Math.max(min, value))
}

export type FloatingVoiceButtonNormalizedPosition = {
  readonly xFrac: number
  readonly yFrac: number
}

// Why fractions of the container rather than raw px: the button must stay put
// (proportionally) across rotation, keyboard, and different screen sizes — the
// stored value is denormalized against whatever the current layout is and
// re-clamped on every read, so it can never land off-screen or under a keyboard
// that grew since the value was saved.
export function normalizeFloatingVoiceButtonPosition(params: {
  x: number
  y: number
  containerWidth: number
  containerHeight: number
}): FloatingVoiceButtonNormalizedPosition {
  const { containerWidth, containerHeight } = params
  return {
    xFrac: containerWidth > 0 ? clamp(params.x / containerWidth, 0, 1) : 0,
    yFrac: containerHeight > 0 ? clamp(params.y / containerHeight, 0, 1) : 0
  }
}

export function denormalizeFloatingVoiceButtonPosition(params: {
  position: FloatingVoiceButtonNormalizedPosition
  diameter: number
  containerWidth: number
  containerHeight: number
  insets: FloatingVoiceButtonInsets
}): FloatingVoiceButtonPoint {
  const { position, containerWidth, containerHeight } = params
  return clampFloatingVoiceButtonPosition({
    x: position.xFrac * containerWidth,
    y: position.yFrac * containerHeight,
    diameter: params.diameter,
    containerWidth,
    containerHeight,
    insets: params.insets
  })
}

export function isFloatingVoiceButtonNormalizedPosition(
  value: unknown
): value is FloatingVoiceButtonNormalizedPosition {
  if (typeof value !== 'object' || value === null) {
    return false
  }
  if (!('xFrac' in value) || !('yFrac' in value)) {
    return false
  }
  const { xFrac, yFrac } = value
  return (
    typeof xFrac === 'number' &&
    typeof yFrac === 'number' &&
    Number.isFinite(xFrac) &&
    Number.isFinite(yFrac) &&
    xFrac >= 0 &&
    xFrac <= 1 &&
    yFrac >= 0 &&
    yFrac <= 1
  )
}

// Default resting spot when the user has never dragged the button: lower
// right, clear of the composer/dock which sit at the very bottom.
export const DEFAULT_FLOATING_VOICE_BUTTON_POSITION: FloatingVoiceButtonNormalizedPosition = {
  xFrac: 0.86,
  yFrac: 0.62
}
