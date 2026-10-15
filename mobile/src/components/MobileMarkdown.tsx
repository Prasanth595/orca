import { INLINE_TEXT_SELECTION } from './inline-text-selection'
import { MobileSelectableText } from './MobileSelectableText'
import { memo, useContext, useMemo, type ReactNode } from 'react'
import { Text as NativeText, View } from 'react-native'
import { styles } from './mobile-markdown-styles'
import { renderBlocks, type MarkdownBlockContext } from './mobile-markdown-blocks'
import { MarkdownText } from './mobile-markdown-text'
import { MarkdownTextContext, type MarkdownTextSetup } from './mobile-markdown-text-setup'
import { useMobileMarkdownTree } from './use-mobile-markdown-tree'
import type { NativeChatVisualDirective } from '../../../src/shared/native-chat-visual-directive'

type Props = {
  content?: string
  fallback?: string
  /** Enables iOS range selection for native-chat transcript prose. */
  rangeSelectable?: boolean
  /** Forward long presses from interactive Android transcript spans to the message. */
  onLongPress?: () => void
  /** Multiplier for the rendered font size (paragraphs, lists, headings, quotes,
   *  code, table cells, and inline image thumbnails). Defaults to 1; the chat view
   *  passes >1 so agent prose reads larger than the compact base. */
  textScale?: number
  /** When provided, detected file paths and file-target hrefs render as tappable
   *  and invoke this with the path text (worktree-relative or absolute, with an
   *  optional :line(:col) suffix). Omitted on screens with no file viewer, where
   *  paths render as plain text (no behavior change). */
  onOpenFile?: (pathText: string) => void
  /** Authored image src → data URL, resolved by the owner; an image whose src has an
   *  entry renders as a real image instead of the tappable fallback text. */
  imageSources?: Record<string, string>
  /** Image taps prefer this with the authored src (resolved against the document by
   *  the owner); without it, image taps route the src as a file href. */
  onOpenImage?: (rawSrc: string) => void
  /** Native-chat assistant prose only: renders `::orca-visual{...}` directive lines. Without it,
   *  a directive line is ordinary text. Must be referentially stable (this component is memoized). */
  renderVisual?: (directive: NativeChatVisualDirective, index: number) => ReactNode
  /** The text is still being appended to: markup its end leaves open is closed, as on desktop,
   *  and a diagram stays code until the text stops. */
  growing?: boolean
}

function MobileMarkdownContent({
  content,
  fallback = '',
  rangeSelectable = false,
  textScale = 1,
  onOpenFile,
  imageSources,
  onOpenImage,
  renderVisual,
  growing = false
}: Props) {
  // Interactive children own their touches and must forward the row action.
  const setup = useContext(MarkdownTextContext)
  const text = content?.trim() ?? ''
  const { root, directives } = useMobileMarkdownTree(text, renderVisual !== undefined, growing)
  if (!text) {
    return fallback ? (
      <MarkdownText selectable={rangeSelectable} style={styles.paragraph}>
        {fallback}
      </MarkdownText>
    ) : null
  }
  // Scale prose sizes; inline spans inherit fontSize from the wrapping Text.
  // Compact bases (code, table cells) keep their tighter 12/17 sheet metrics.
  const scaled = (
    size: number,
    lineHeight = size + 6
  ): { fontSize: number; lineHeight: number } | null =>
    textScale !== 1 ? { fontSize: size * textScale, lineHeight: lineHeight * textScale } : null
  const ctx: MarkdownBlockContext = {
    growing,
    onOpenFile,
    imageSources,
    onOpenImage,
    textScale,
    listText: [styles.listText, scaled(14)],
    listMarkerText: scaled(13),
    headingText: scaled(14),
    headingLargeText: scaled(15),
    quoteText: scaled(13),
    codeText: scaled(12, 17),
    tableCellText: scaled(12, 17),
    rowLongPress: setup.androidTranscript ? setup.onLongPress : undefined,
    directives,
    renderVisual,
    mermaidOccurrences: new Map()
  }
  // Native-chat range selection is set on each block; nested inline spans inherit it.
  return (
    <View style={styles.root}>
      {renderBlocks(root.children, ctx, {
        style: [styles.paragraph, scaled(13)],
        selectable: rangeSelectable
      })}
    </View>
  )
}

function MobileMarkdownInner(props: Props): React.JSX.Element | null {
  const { rangeSelectable = false, onLongPress } = props
  // Other Markdown surfaces retain their existing selection behavior.
  const androidTranscript = rangeSelectable && !INLINE_TEXT_SELECTION
  const setup = useMemo<MarkdownTextSetup>(
    () => ({
      TextComponent: rangeSelectable && !androidTranscript ? MobileSelectableText : NativeText,
      androidTranscript,
      ...(onLongPress ? { onLongPress } : {})
    }),
    [rangeSelectable, androidTranscript, onLongPress]
  )
  return (
    <MarkdownTextContext.Provider value={setup}>
      <MobileMarkdownContent {...props} />
    </MarkdownTextContext.Provider>
  )
}

export const MobileMarkdown = memo(MobileMarkdownInner)
