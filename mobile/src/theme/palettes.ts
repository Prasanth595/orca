// Colour palettes, free of side effects so the boot module can import them without fixing the
// palette choice (mobile-theme.ts reads the boot globals at import time).

export const darkColors = {
  bgBase: '#111111',
  bgPanel: '#1a1a1a',
  bgRaised: '#242424',
  borderSubtle: '#2a2a2a',
  editorSurface: '#1e1e1e',

  textPrimary: '#e0e0e0',
  textSecondary: '#a1a1a1',
  textMuted: '#8c8c8c',

  // Crisp near-white surface for the single primary action on a screen (the
  // worktree FAB). Brighter than textPrimary so it reads as a solid button, not
  // disabled chrome, while staying monochrome (STYLEGUIDE: color is for state).
  surfaceBright: '#f5f5f5',
  // Text/icon colour on a filled primary button (textPrimary or surfaceBright fill). A token of its
  // own because high contrast drops button fills, and the content must then turn dark too.
  onFill: '#111111',

  accentBlue: '#3b82f6',
  // Text/icon color on a filled accent (accentBlue) button, where the muted
  // textPrimary would lack contrast against the saturated fill.
  onAccent: '#ffffff',

  statusGreen: '#22c55e',
  statusAmber: '#f59e0b',
  statusRed: '#ef4444',
  // Merge CTA fill + its on-fill text, mirroring the desktop ChecksPanel's
  // bg-green-600 "Squash and merge" button (green-600 / white).
  mergeGreen: '#16a34a',
  onMergeGreen: '#ffffff',
  // Merged-PR purple, mirroring the desktop ReviewIcon's purple-400/70 tone.
  statusPurple: '#a78bfa',
  gitDecorationAdded: '#81b88b',
  gitDecorationDeleted: '#c74e39',
  diffAddedBg: 'rgba(129, 184, 139, 0.1)',
  diffDeletedBg: 'rgba(199, 78, 57, 0.11)',

  syntaxComment: '#6a9955',
  syntaxKeyword: '#569cd6',
  syntaxString: '#ce9178',
  syntaxNumber: '#b5cea8',
  syntaxType: '#4ec9b0',
  syntaxFunction: '#dcdcaa',
  syntaxVariable: '#9cdcfe',
  syntaxMeta: '#c586c0',

  // Terminal WebView background (Tokyonight) — separate from app chrome
  terminalBg: '#1a1b26'
}

// Why pure white and near-black: on e-ink, white is the uninked state and faint greys
// dither into noise, so the light palette favours solid, high-contrast values.
export const lightColors: typeof darkColors = {
  bgBase: '#ffffff',
  bgPanel: '#f5f5f5',
  bgRaised: '#ebebeb',
  borderSubtle: '#d4d4d4',
  editorSurface: '#ffffff',

  textPrimary: '#111111',
  textSecondary: '#404040',
  textMuted: '#595959',

  // Inverted: the primary action reads as a solid dark button on a light screen.
  surfaceBright: '#1a1a1a',
  onFill: '#ffffff',

  accentBlue: '#2563eb',
  onAccent: '#ffffff',

  statusGreen: '#15803d',
  statusAmber: '#b45309',
  statusRed: '#dc2626',
  mergeGreen: '#16a34a',
  onMergeGreen: '#ffffff',
  statusPurple: '#7c3aed',
  gitDecorationAdded: '#2e7d32',
  gitDecorationDeleted: '#c62828',
  diffAddedBg: 'rgba(46, 125, 50, 0.14)',
  diffDeletedBg: 'rgba(198, 40, 40, 0.14)',

  // VS Code Light+ syntax colours.
  syntaxComment: '#008000',
  syntaxKeyword: '#0000ff',
  syntaxString: '#a31515',
  syntaxNumber: '#098658',
  syntaxType: '#267f99',
  syntaxFunction: '#795e26',
  syntaxVariable: '#001080',
  syntaxMeta: '#af00db',

  terminalBg: '#ffffff'
}

// High contrast, for e-ink: every grey is an exact 16-level greyscale step (a multiple of 0x11),
// so the panel neither dithers nor quantises two surfaces into one; separation comes from dark
// borders instead of near-identical fills.
export const highContrastLightColors: typeof darkColors = {
  ...lightColors,
  bgPanel: '#ffffff',
  bgRaised: '#eeeeee',
  borderSubtle: '#222222',
  textPrimary: '#000000',
  textSecondary: '#111111',
  textMuted: '#333333',
  surfaceBright: '#000000',
  // Buttons are outlined, not filled, in high contrast (see high-contrast-outline.ts).
  onFill: '#000000',
  onAccent: '#000000',
  onMergeGreen: '#000000',
  accentBlue: '#1d4ed8',
  statusGreen: '#166534',
  statusAmber: '#92400e',
  statusRed: '#b91c1c',
  statusPurple: '#5b21b6',
  gitDecorationAdded: '#166534',
  gitDecorationDeleted: '#b91c1c',
  diffAddedBg: 'rgba(22, 101, 52, 0.2)',
  diffDeletedBg: 'rgba(185, 28, 28, 0.2)'
}

export const highContrastDarkColors: typeof darkColors = {
  ...darkColors,
  bgBase: '#000000',
  bgPanel: '#000000',
  bgRaised: '#222222',
  borderSubtle: '#dddddd',
  editorSurface: '#000000',
  textPrimary: '#ffffff',
  textSecondary: '#eeeeee',
  textMuted: '#cccccc',
  surfaceBright: '#ffffff',
  onFill: '#ffffff',
  onAccent: '#ffffff',
  onMergeGreen: '#ffffff',
  terminalBg: '#000000'
}
