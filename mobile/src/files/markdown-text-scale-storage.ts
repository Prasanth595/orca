import AsyncStorage from '@react-native-async-storage/async-storage'
import { MARKDOWN_TEXT_SCALES } from './markdown-text-scales'

const MARKDOWN_TEXT_SCALE_KEY = 'orca:markdownTextScale'
const DEFAULT_MARKDOWN_TEXT_SCALE = 1

export async function loadMarkdownTextScale(): Promise<number> {
  try {
    const raw = await AsyncStorage.getItem(MARKDOWN_TEXT_SCALE_KEY)
    if (raw === null) {
      return DEFAULT_MARKDOWN_TEXT_SCALE
    }
    const parsed = Number(raw)
    return MARKDOWN_TEXT_SCALES.find((preset) => preset === parsed) ?? DEFAULT_MARKDOWN_TEXT_SCALE
  } catch {
    return DEFAULT_MARKDOWN_TEXT_SCALE
  }
}

// Why plain AsyncStorage, not persistMirrored: nothing reads this synchronously on init — the
// native viewer and the editor WebView both get the value from React props / a post-ready inject.
export async function saveMarkdownTextScale(scale: number): Promise<void> {
  await AsyncStorage.setItem(MARKDOWN_TEXT_SCALE_KEY, String(scale))
}
