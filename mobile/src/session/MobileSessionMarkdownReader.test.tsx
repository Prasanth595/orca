import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MarkdownReader } from './MobileSessionMarkdownReader'
import type { MarkdownDocState } from './mobile-session-route-types'

vi.mock('react-native', () => ({
  ActivityIndicator: 'ActivityIndicator',
  Platform: { OS: 'ios', select: (choices: Record<string, unknown>) => choices.ios },
  Pressable: 'Pressable',
  StyleSheet: { create: <T,>(styles: T) => styles, hairlineWidth: 1 },
  Text: 'Text',
  View: 'View'
}))

vi.mock('lucide-react-native', () => ({ RefreshCw: 'RefreshCw' }))

// Records what the WebView editor would receive; the bridge itself is covered elsewhere.
const editorProps: Array<Record<string, unknown>> = []
vi.mock('../components/MobileRichMarkdownEditor', () => ({
  MobileRichMarkdownEditor: (props: Record<string, unknown>) => {
    editorProps.push(props)
    return null
  }
}))

vi.mock('./mobile-session-styles', () => ({ styles: {} }))

const readyDoc: MarkdownDocState = {
  status: 'ready',
  content: '# Notes',
  localContent: '# Notes',
  baseVersion: '1',
  isDirty: false,
  editable: true
}

describe('MarkdownReader', () => {
  let renderer: ReactTestRenderer | null = null

  afterEach(() => {
    act(() => renderer?.unmount())
    renderer = null
    editorProps.length = 0
  })

  function render(doc: MarkdownDocState, onOpenImage: (rawSrc: string) => void): void {
    act(() => {
      renderer = create(
        createElement(MarkdownReader, {
          documentId: 'doc-1',
          doc,
          onRefresh: vi.fn(),
          onChange: vi.fn(),
          onSave: vi.fn(),
          onCopy: vi.fn(),
          onDiscard: vi.fn(),
          onOpenImage,
          keyboardLift: 0
        })
      )
    })
  }

  it('forwards the doc image sources to the editor', () => {
    const imageSources = { 'images/shot.png': 'data:image/png;base64,AAA' }
    render({ ...readyDoc, imageSources }, vi.fn())
    expect(editorProps.at(-1)?.imageSources).toBe(imageSources)
  })

  it('forwards the image-tap handler to the editor', () => {
    const onOpenImage = vi.fn()
    render(readyDoc, onOpenImage)
    expect(editorProps.at(-1)?.onOpenImage).toBe(onOpenImage)
  })
})

describe('live session markdown reader copy', () => {
  let renderer: ReactTestRenderer | undefined
  const onCopy = vi.fn(),
    onSave = vi.fn(),
    onDiscard = vi.fn(),
    onRefresh = vi.fn()
  function render(value: MarkdownDocState | undefined = readyDoc) {
    act(() => {
      renderer = create(
        createElement(MarkdownReader, {
          documentId: 'doc',
          doc: value,
          onCopy,
          onSave,
          onDiscard,
          onRefresh,
          onChange: vi.fn(),
          keyboardLift: 0,
          onOpenImage: vi.fn()
        })
      )
    })
  }
  const buttons = () => renderer!.root.findAll((node) => String(node.type) === 'Pressable')
  beforeEach(() => vi.clearAllMocks())
  afterEach(() => act(() => renderer?.unmount()))

  it.each([
    ['editable', {}],
    ['dirty', { isDirty: true, localContent: '# Unsaved' }],
    ['read-only', { editable: false }],
    ['saving', { isDirty: true, saving: true }]
  ] as const)(
    'offers Copy on a ready %s document without saving or discarding',
    (_name, fields) => {
      render({ ...readyDoc, ...fields })
      const copy = buttons().find(
        (node) => node.props.accessibilityLabel === 'Copy Markdown source'
      )
      expect(copy).toBeDefined()
      expect(copy?.props.accessibilityRole).toBe('button')
      expect(copy?.props.disabled).not.toBe(true)
      act(() => copy?.props.onPress())
      expect(onCopy).toHaveBeenCalledOnce()
      expect(onSave).not.toHaveBeenCalled()
      expect(onDiscard).not.toHaveBeenCalled()
    }
  )

  it('keeps loading and error states free of copy actions', () => {
    render({ status: 'loading' })
    expect(buttons()).toHaveLength(0)
    act(() =>
      renderer!.update(
        createElement(MarkdownReader, {
          documentId: 'doc',
          doc: { status: 'error', message: 'Unavailable' },
          onCopy,
          onSave,
          onDiscard,
          onRefresh,
          onChange: vi.fn(),
          keyboardLift: 0,
          onOpenImage: vi.fn()
        })
      )
    )
    expect(buttons()).toHaveLength(1)
    act(() => buttons()[0]!.props.onPress())
    expect(onRefresh).toHaveBeenCalledOnce()
    expect(onCopy).not.toHaveBeenCalled()
  })
})
