type StyleMap = Record<string, unknown>

function isStyleMap(value: unknown): value is StyleMap {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export type OutlinePalette = {
  textPrimary: string
  surfaceBright: string
  accentBlue: string
  mergeGreen: string
  statusGreen: string
  statusRed: string
  bgRaised: string
}

// Why skip borders on pressed variants: they are merged over a base style, so adding a border
// there would shift the layout on every press; they just lose their fill. `*Active` styles mean
// "selected", so they are outlined like any strong fill and keep a visible indicator.
const PRESS_STATE = /pressed/i

/**
 * High contrast (e-ink): turns every filled button style into an outlined one. A solid fill costs
 * an e-ink panel a full-area redraw and ghosts on press; a transparent body with a black border
 * stays crisp. Primary/selected fills get a thicker border so "selected" survives without a fill.
 */
export function outlineFilledButtons<T extends StyleMap>(styles: T, palette: OutlinePalette): T {
  const strong = new Set([
    palette.textPrimary,
    palette.surfaceBright,
    palette.accentBlue,
    palette.mergeGreen
  ])
  // Status fills keep their own colour as the border; a green fill left in place would put the
  // on-colour (check icons, "Done" labels) on a background it cannot reach 4.5:1 against.
  const status = new Set([palette.statusRed, palette.statusGreen])
  const filled = new Set([...strong, ...status, palette.bgRaised])
  const outlined: StyleMap = {}
  for (const [name, style] of Object.entries(styles)) {
    const background = isStyleMap(style) ? style.backgroundColor : undefined
    if (!isStyleMap(style) || typeof background !== 'string' || !filled.has(background)) {
      outlined[name] = style
      continue
    }
    const next: StyleMap = { ...style, backgroundColor: 'transparent' }
    if (!PRESS_STATE.test(name)) {
      const current = typeof next.borderWidth === 'number' ? next.borderWidth : 0
      const thick = strong.has(background) || background === palette.statusGreen
      next.borderWidth = Math.max(current, thick ? 2 : 1)
      next.borderColor = status.has(background) ? background : palette.textPrimary
    }
    outlined[name] = next
  }
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: outlined has exactly the keys of styles; only fill/border props of button styles change.
  return outlined as T
}
