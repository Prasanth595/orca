// The two per-launch appearance values, written once by appearance-boot.ts (or web-entry/color-scheme.ts)
// and read by mobile-theme.ts. Declared once here so no reader needs a type assertion. Types only,
// so nothing extra is bundled into the terminal WebView script.
declare var __orcaColorScheme: string | undefined
declare var __orcaHighContrast: boolean | undefined
