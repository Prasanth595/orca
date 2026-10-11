// Route A page counterpart of src/theme/appearance-boot.ts, which needs native file access and
// cannot run here. The WebView inherits the app's uiMode, so prefers-color-scheme matches the
// system theme. The in-app Theme/Contrast/Text size overrides are not applied here.
globalThis.__orcaColorScheme = window.matchMedia?.('(prefers-color-scheme: light)').matches
  ? 'light'
  : 'dark'
