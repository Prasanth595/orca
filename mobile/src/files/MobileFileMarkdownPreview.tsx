import { useState } from 'react'
import { Pressable, ScrollView, View } from 'react-native'
import { GestureDetector, GestureHandlerRootView } from 'react-native-gesture-handler'
import { Code, Pencil, Type } from 'lucide-react-native'
import { MobileMarkdown } from '../components/MobileMarkdown'
import { PickerModal } from '../components/PickerModal'
import { colors } from '../theme/mobile-theme'
import {
  TEXT_SIZE_OPTIONS,
  type TextSizeValue,
  useMarkdownTextScale
} from './use-markdown-text-scale'
import { useMarkdownTextScalePinchGesture } from './use-markdown-text-scale-pinch-gesture'
import {
  MobileFilePreviewSourceText,
  MobileFilePreviewTruncatedNote
} from './MobileFilePreviewSourceText'
import { filePreviewStyles as styles } from './mobile-file-preview-styles'

type Props = {
  relativePath: string
  content: string
  truncated: boolean
  byteLength: number
  initialLine?: number
}

export function MobileFileMarkdownPreview({
  relativePath,
  content,
  truncated,
  byteLength,
  initialLine
}: Props) {
  const [mode, setMode] = useState<'preview' | 'source'>(() => (initialLine ? 'source' : 'preview'))
  const [previousRelativePath, setPreviousRelativePath] = useState(relativePath)
  const [previousInitialLine, setPreviousInitialLine] = useState(initialLine)
  // Why: opening a different file or line target must switch modes before paint,
  // never briefly retain the prior file's manually selected mode.
  if (relativePath !== previousRelativePath || initialLine !== previousInitialLine) {
    setPreviousRelativePath(relativePath)
    setPreviousInitialLine(initialLine)
    setMode(initialLine ? 'source' : 'preview')
  }
  const previewSelected = mode === 'preview'
  const sourceSelected = mode === 'source'

  // Why one persisted value: the toolbar picker and pinch-to-zoom both read and
  // write `textScale` — pinching updates this state live, and the picker jumps
  // straight to a preset, exactly like the terminal's text-size setting.
  const { textScale, setLiveScale, commitTextScale, selectTextSize } = useMarkdownTextScale()
  const [textSizePickerOpen, setTextSizePickerOpen] = useState(false)
  const pinchGesture = useMarkdownTextScalePinchGesture(textScale, setLiveScale, commitTextScale)

  return (
    <View style={styles.modeContainer}>
      <View style={styles.modeToolbar}>
        <Pressable
          style={[styles.modeToggle, sourceSelected && styles.modeToggleActive]}
          onPress={() => setMode('source')}
          accessibilityRole="button"
          accessibilityState={{ selected: sourceSelected }}
          accessibilityLabel="View Markdown source"
        >
          <Code
            size={15}
            color={sourceSelected ? colors.textPrimary : colors.textSecondary}
            strokeWidth={2.2}
          />
        </Pressable>
        <Pressable
          style={[styles.modeToggle, previewSelected && styles.modeToggleActive]}
          onPress={() => setMode('preview')}
          accessibilityRole="button"
          accessibilityState={{ selected: previewSelected }}
          accessibilityLabel="View rendered Markdown preview"
        >
          <Pencil
            size={15}
            color={previewSelected ? colors.textPrimary : colors.textSecondary}
            strokeWidth={2.2}
          />
        </Pressable>
        {previewSelected ? (
          <Pressable
            style={styles.modeToggle}
            onPress={() => setTextSizePickerOpen(true)}
            accessibilityRole="button"
            accessibilityLabel="Markdown text size"
          >
            <Type size={15} color={colors.textSecondary} strokeWidth={2.2} />
          </Pressable>
        ) : null}
      </View>
      {mode === 'preview' ? (
        <GestureHandlerRootView style={styles.modeContainer}>
          <GestureDetector gesture={pinchGesture}>
            <ScrollView style={styles.scroll} contentContainerStyle={styles.markdownContent}>
              {truncated ? <MobileFilePreviewTruncatedNote byteLength={byteLength} /> : null}
              <MobileMarkdown content={content} textScale={textScale} scaleAllBlocks />
            </ScrollView>
          </GestureDetector>
        </GestureHandlerRootView>
      ) : (
        <MobileFilePreviewSourceText
          relativePath={relativePath}
          content={content}
          truncated={truncated}
          byteLength={byteLength}
          initialLine={initialLine}
        />
      )}
      <PickerModal<TextSizeValue>
        visible={textSizePickerOpen}
        title="Markdown text size"
        options={TEXT_SIZE_OPTIONS}
        selected={String(textScale)}
        onSelect={selectTextSize}
        onClose={() => setTextSizePickerOpen(false)}
      />
    </View>
  )
}
