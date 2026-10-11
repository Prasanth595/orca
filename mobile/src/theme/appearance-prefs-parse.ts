export type ThemePreference = 'system' | 'light' | 'dark'
export type ContrastPreference = 'normal' | 'high'
export type AppearancePrefs = {
  theme: ThemePreference
  contrast: ContrastPreference
  textScale: number
}

export const TEXT_SCALES = [0.85, 1, 1.15, 1.3, 1.5] as const
export const DEFAULT_APPEARANCE_PREFS: AppearancePrefs = {
  theme: 'system',
  contrast: 'normal',
  textScale: 1
}

function isTextScale(value: unknown): value is AppearancePrefs['textScale'] {
  return TEXT_SCALES.some((scale) => scale === value)
}

export function parseAppearancePrefs(raw: string | null): AppearancePrefs {
  try {
    const parsed: unknown = JSON.parse(raw ?? '{}')
    const field = (key: string): unknown =>
      typeof parsed === 'object' && parsed !== null ? Reflect.get(parsed, key) : undefined
    const theme = field('theme')
    const textScale = field('textScale')
    return {
      theme: theme === 'light' || theme === 'dark' ? theme : 'system',
      contrast: field('contrast') === 'high' ? 'high' : 'normal',
      textScale: isTextScale(textScale) ? textScale : 1
    }
  } catch {
    return DEFAULT_APPEARANCE_PREFS
  }
}
