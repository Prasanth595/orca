import { useState } from 'react'
import { View, Text, Pressable, ActivityIndicator } from 'react-native'
import { GestureDetector, GestureHandlerRootView } from 'react-native-gesture-handler'
import { RefreshCw, Type } from 'lucide-react-native'
import { MobileRichMarkdownEditor } from '../components/MobileRichMarkdownEditor'
import { PickerModal } from '../components/PickerModal'
import {
  TEXT_SIZE_OPTIONS,
  type TextSizeValue,
  useMarkdownTextScale
} from '../files/use-markdown-text-scale'
import { useMarkdownTextScalePinchGesture } from '../files/use-markdown-text-scale-pinch-gesture'
import { resolveMarkdownFloatingActionsBottom } from './markdown-floating-actions-layout'
import { markdownReaderStatusText } from './mobile-markdown-reader-status'
import { colors, spacing } from '../theme/mobile-theme'
import { styles } from './mobile-session-styles'
import type { MarkdownDocState } from './mobile-session-route-types'

export function MarkdownReader({
  documentId,
  doc,
  onRefresh,
  onChange,
  onSave,
  onCopy,
  onDiscard,
  keyboardLift
}: {
  documentId: string
  doc: MarkdownDocState | undefined
  onRefresh: () => void
  onChange: (content: string) => void
  onSave: () => void
  onCopy: () => void
  onDiscard: () => void
  keyboardLift: number
}) {
  // Native Keyboard events under-report the WebView editor's covered area, so prefer the larger WebView-measured inset.
  const [webviewKeyboardInset, setWebviewKeyboardInset] = useState(0)
  const effectiveKeyboardLift = Math.max(keyboardLift, webviewKeyboardInset)

  const { textScale, setLiveScale, commitTextScale, selectTextSize } = useMarkdownTextScale()
  const [textSizePickerOpen, setTextSizePickerOpen] = useState(false)
  // Why RNGH over in-page touch handling: the editor's surface is contenteditable, so text
  // selection/caret placement and link taps must keep working under single-finger touches.
  // `Gesture.Pinch()` on the wrapping View only ever activates once a second touch lands, so it
  // never claims the single-finger touches the WebView's own editing/selection/scroll use — no
  // `Gesture.Native()` composition needed, unlike the file viewer's ScrollView, because the
  // wrapper here is a plain View rather than the scrollable native component itself. In-page touch
  // handling (the terminal's approach) would have to reimplement that split by hand inside the
  // WebView document instead of getting it from RNGH for free.
  const pinchGesture = useMarkdownTextScalePinchGesture(
    textScale,
    setLiveScale,
    commitTextScale,
    false
  )

  if (!doc || doc.status === 'loading') {
    return (
      <View style={styles.markdownState}>
        <ActivityIndicator size="small" color={colors.textSecondary} />
      </View>
    )
  }
  if (doc.status === 'error') {
    return (
      <View style={styles.markdownState}>
        <Text style={styles.markdownError}>{doc.message}</Text>
        <Pressable style={styles.markdownRefreshButton} onPress={onRefresh}>
          <RefreshCw size={14} color={colors.textPrimary} />
          <Text style={styles.markdownRefreshText}>Retry</Text>
        </Pressable>
      </View>
    )
  }

  const statusText = markdownReaderStatusText(doc)
  const showRefresh = (doc.stale && !doc.isDirty) || !doc.editable
  const showCopy = doc.saveError || !doc.editable
  const showSave = doc.isDirty || doc.saving
  const showFloatingActions = statusText || showRefresh || showCopy || showSave

  return (
    <View style={styles.markdownEditor}>
      <GestureHandlerRootView style={styles.markdownEditor}>
        <GestureDetector gesture={pinchGesture}>
          <View style={styles.markdownEditor}>
            <MobileRichMarkdownEditor
              key={documentId}
              content={doc.localContent}
              editable={doc.editable && !doc.saving}
              textScale={textScale}
              onChange={onChange}
              onKeyboardInsetChange={setWebviewKeyboardInset}
            />
          </View>
        </GestureDetector>
      </GestureHandlerRootView>
      <Pressable
        style={styles.markdownTextSizeButton}
        onPress={() => setTextSizePickerOpen(true)}
        accessibilityRole="button"
        accessibilityLabel="Markdown text size"
      >
        <Type size={15} color={colors.textSecondary} strokeWidth={2.2} />
      </Pressable>
      <PickerModal<TextSizeValue>
        visible={textSizePickerOpen}
        title="Markdown text size"
        options={TEXT_SIZE_OPTIONS}
        selected={String(textScale)}
        onSelect={selectTextSize}
        onClose={() => setTextSizePickerOpen(false)}
      />
      {showFloatingActions ? (
        <View
          pointerEvents="box-none"
          style={[
            styles.markdownFloatingBar,
            // Why: editor focus lives in a WebView, so lift native Save/Discard controls instead of resizing it.
            {
              bottom: resolveMarkdownFloatingActionsBottom({
                keyboardLift: effectiveKeyboardLift,
                restingBottom: spacing.lg,
                liftedClearance: spacing.md
              })
            }
          ]}
        >
          {statusText ? (
            <Text
              style={[styles.markdownFloatingStatus, doc.saveError ? styles.markdownError : null]}
              numberOfLines={2}
            >
              {statusText}
            </Text>
          ) : null}
          <View style={styles.markdownFloatingActions}>
            {showCopy ? (
              <Pressable style={styles.markdownFloatingButton} onPress={onCopy}>
                <Text style={styles.markdownFloatingButtonText}>Copy</Text>
              </Pressable>
            ) : null}
            {showRefresh ? (
              <Pressable style={styles.markdownFloatingButton} onPress={onRefresh}>
                <RefreshCw size={13} color={colors.textPrimary} />
                <Text style={styles.markdownFloatingButtonText}>Refresh</Text>
              </Pressable>
            ) : null}
            {doc.isDirty ? (
              <Pressable style={styles.markdownFloatingButton} onPress={onDiscard}>
                <Text style={styles.markdownFloatingButtonText}>Discard</Text>
              </Pressable>
            ) : null}
            {showSave ? (
              <Pressable
                style={[
                  styles.markdownFloatingButton,
                  styles.markdownSaveButton,
                  (!doc.editable || !doc.isDirty || doc.saving) && styles.markdownButtonDisabled
                ]}
                disabled={!doc.editable || !doc.isDirty || doc.saving}
                onPress={onSave}
              >
                {doc.saving ? (
                  <ActivityIndicator size="small" color={colors.textPrimary} />
                ) : (
                  <Text style={styles.markdownFloatingButtonText}>Save</Text>
                )}
              </Pressable>
            ) : null}
          </View>
        </View>
      ) : null}
    </View>
  )
}
