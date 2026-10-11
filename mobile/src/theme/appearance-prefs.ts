import { File, Paths } from 'expo-file-system'
import {
  DEFAULT_APPEARANCE_PREFS,
  parseAppearancePrefs,
  type AppearancePrefs
} from './appearance-prefs-parse'

// Why a file and not AsyncStorage: the boot module needs these synchronously, before any
// StyleSheet is built, and AsyncStorage can only be awaited.
function prefsFile(): File {
  return new File(Paths.document, 'appearance.json')
}

export function readAppearancePrefs(): AppearancePrefs {
  try {
    const file = prefsFile()
    return parseAppearancePrefs(file.exists ? file.textSync() : null)
  } catch {
    return DEFAULT_APPEARANCE_PREFS
  }
}

export function writeAppearancePrefs(prefs: AppearancePrefs): void {
  prefsFile().write(JSON.stringify(prefs))
}
