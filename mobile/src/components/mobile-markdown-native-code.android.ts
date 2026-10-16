import { requireOptionalNativeModule } from 'expo-modules-core'
import type { NativeMarkdownCode } from './mobile-markdown-native-code-contract'

// Older shells can receive newer page code: keep ordinary selectable text as the fallback.
export const nativeMarkdownCode =
  requireOptionalNativeModule<NativeMarkdownCode>('OrcaMarkdownInlineCode')
