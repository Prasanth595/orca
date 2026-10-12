/**
 * Text-scale presets for the Markdown viewers (file preview and the session's rich editor). Mirrors
 * `terminal-text-scales.ts`: discrete presets keep the toolbar picker simple,
 * and pinch-to-zoom snaps to these same values so the toolbar and pinch
 * always agree on one persisted number.
 */
export const MARKDOWN_TEXT_SCALES = [0.75, 1, 1.25, 1.5, 1.75, 2] as const

export const MARKDOWN_TEXT_SCALE_MIN = MARKDOWN_TEXT_SCALES[0]
export const MARKDOWN_TEXT_SCALE_MAX = MARKDOWN_TEXT_SCALES[MARKDOWN_TEXT_SCALES.length - 1]

/** Clamp a proposed scale into the supported range. */
export function clampMarkdownTextScale(scale: number): number {
  if (Number.isNaN(scale)) {
    return 1
  }
  return Math.min(MARKDOWN_TEXT_SCALE_MAX, Math.max(MARKDOWN_TEXT_SCALE_MIN, scale))
}

/** Snap a proposed scale (e.g. a live pinch value) to the nearest preset. */
export function snapMarkdownTextScale(scale: number): number {
  const clamped = clampMarkdownTextScale(scale)
  return MARKDOWN_TEXT_SCALES.reduce((closest, preset) =>
    Math.abs(preset - clamped) < Math.abs(closest - clamped) ? preset : closest
  )
}

/** Live pinch values move in 0.05 steps; the commit still snaps to a preset. */
export function quantizeLiveScale(scale: number): number {
  return Math.round(scale * 20) / 20
}
