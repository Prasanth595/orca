type StyleMap = Record<string, unknown>

// Plain style objects only: arrays (composed styles) and primitives are left alone.
function isStyleMap(value: unknown): value is StyleMap {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Multiplies every numeric fontSize and lineHeight in a StyleSheet.create() input by `scale`.
 * When text grows, a fixed `height` becomes a `minHeight` so rows, tabs and pills grow with their
 * text instead of clipping it, and height caps grow in proportion; squares (icons, dots, round
 * buttons) and thin rules keep their size.
 */
export function scaleTextStyles<T extends StyleMap>(styles: T, scale: number): T {
  if (scale === 1) {
    return styles
  }
  const scaled: StyleMap = {}
  for (const [name, style] of Object.entries(styles)) {
    if (!isStyleMap(style)) {
      scaled[name] = style
      continue
    }
    const next: StyleMap = { ...style }
    for (const key of ['fontSize', 'lineHeight']) {
      const value = next[key]
      if (typeof value === 'number') {
        next[key] = Math.round(value * scale * 2) / 2
      }
    }
    const height = next.height
    if (scale > 1 && typeof height === 'number' && height >= 16 && next.width !== height) {
      delete next.height
      next.minHeight = Math.max(height, typeof next.minHeight === 'number' ? next.minHeight : 0)
    }
    // A height cap bounds a strip of text (e.g. the session tab scroller), so it grows with it.
    if (scale > 1 && typeof next.maxHeight === 'number' && next.maxHeight >= 16) {
      next.maxHeight = Math.ceil(next.maxHeight * scale)
    }
    scaled[name] = next
  }
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: scaled has exactly the keys of styles, each value either untouched or the same style object with numbers rescaled.
  return scaled as T
}
