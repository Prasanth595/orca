import { Text } from 'react-native'
import type { MarkdownTextProps } from './mobile-markdown-inline-code-ranges'

export function MobileMarkdownNativeText({ inlineCode: _inlineCode, ...props }: MarkdownTextProps) {
  return <Text {...props} />
}
