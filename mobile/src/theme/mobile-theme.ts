// Orca mobile design tokens — matches desktop graphite/dark palette, plus a light
// palette for light-mode devices (and e-ink readers, where a dark UI is unusable).
// All screen files should import from here instead of using inline hex values.

import {
  darkColors,
  highContrastDarkColors,
  highContrastLightColors,
  lightColors
} from './palettes'

export { darkColors, highContrastDarkColors, highContrastLightColors, lightColors }

// Why a global instead of importing Appearance here: this module is also bundled into the
// terminal WebView document script, where react-native does not exist. appearance-boot.ts
// sets it before any screen module evaluates, and there it falls back to dark.
// The scheme is fixed per app launch (StyleSheets are built at import time), so switching
// the OS theme applies on the next cold start.

export const isLightTheme = globalThis.__orcaColorScheme === 'light'
export const isHighContrast = globalThis.__orcaHighContrast === true

export const colors = isHighContrast
  ? isLightTheme
    ? highContrastLightColors
    : highContrastDarkColors
  : isLightTheme
    ? lightColors
    : darkColors

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24
} as const

export const radii = {
  row: 6,
  card: 14,
  button: 6,
  input: 6,
  camera: 8
} as const

export const typography = {
  titleSize: 18,
  bodySize: 14,
  metaSize: 12,
  monoFamily: 'monospace' as const
} as const
