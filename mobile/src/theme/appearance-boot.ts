import { Appearance, StyleSheet } from 'react-native'
import { readAppearancePrefs } from './appearance-prefs'
import { outlineFilledButtons } from './high-contrast-outline'
import { highContrastDarkColors, highContrastLightColors } from './palettes'
import { scaleTextStyles } from './scale-text-styles'

// Why a boot module: mobile-theme.ts picks its palette once, at import time, and cannot import
// react-native itself; and ~100 screens build their StyleSheets at import time. index.js imports
// this before the router so every palette read and StyleSheet.create below sees the user's choice.
// Both therefore apply from the next app launch, which Settings → Display says.
const prefs = readAppearancePrefs()

globalThis.__orcaColorScheme =
  prefs.theme === 'system' ? (Appearance.getColorScheme() ?? 'dark') : prefs.theme
globalThis.__orcaHighContrast = prefs.contrast === 'high'

const outlinePalette =
  globalThis.__orcaColorScheme === 'light' ? highContrastLightColors : highContrastDarkColors

if (prefs.textScale !== 1 || globalThis.__orcaHighContrast) {
  // This covers styles built with StyleSheet.create (nearly all of them); inline style
  // literals keep their size and fill. Text size stacks with the Android/iOS system font size.
  const create = StyleSheet.create
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the wrapper returns create()'s result for the same input shape; only text sizes and button fills change.
  StyleSheet.create = ((styles) => {
    if (styles === null || styles === undefined) {
      return create(styles)
    }
    let next = scaleTextStyles(styles, prefs.textScale)
    if (globalThis.__orcaHighContrast) {
      next = outlineFilledButtons(next, outlinePalette)
    }
    return create(next)
  }) as typeof create
}
