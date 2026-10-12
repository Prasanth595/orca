import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { MobileFileMarkdownPreview } from './MobileFileMarkdownPreview'

vi.mock('react-native', () => ({
  Pressable: 'Pressable',
  ScrollView: 'ScrollView',
  View: 'View',
  Platform: { OS: 'ios' }
}))

vi.mock('lucide-react-native', () => ({
  Code: 'Code',
  Pencil: 'Pencil',
  Type: 'Type'
}))

vi.mock('../components/MobileMarkdown', () => ({
  MobileMarkdown: 'MobileMarkdown'
}))

vi.mock('../components/PickerModal', () => ({
  PickerModal: 'PickerModal'
}))

vi.mock('./MobileFilePreviewSourceText', () => ({
  MobileFilePreviewSourceText: 'MobileFilePreviewSourceText',
  MobileFilePreviewTruncatedNote: 'MobileFilePreviewTruncatedNote'
}))

vi.mock('../theme/mobile-theme', () => ({
  colors: { textPrimary: '#fff', textSecondary: '#999' }
}))

vi.mock('./mobile-file-preview-styles', () => ({
  filePreviewStyles: {}
}))

vi.mock('./markdown-text-scale-storage', () => ({
  loadMarkdownTextScale: vi.fn(async () => 1),
  saveMarkdownTextScale: vi.fn(async () => undefined)
}))

// Why: the real module pulls in react-native's native gesture view configs,
// which aren't parseable outside a device/simulator runtime — same reason
// MobileNativeChatView.test.ts stubs the chainable gesture builder.
vi.mock('react-native-gesture-handler', () => {
  const chain = {
    enabled: () => chain,
    runOnJS: () => chain,
    onStart: () => chain,
    onUpdate: () => chain,
    onEnd: () => chain
  }
  return {
    Gesture: { Simultaneous: () => ({}), Native: () => ({}), Pinch: () => chain },
    GestureDetector: 'GestureDetector',
    GestureHandlerRootView: 'GestureHandlerRootView'
  }
})

type PreviewProps = Parameters<typeof MobileFileMarkdownPreview>[0]

async function renderPreview(props: PreviewProps): Promise<ReactTestRenderer> {
  let renderer: ReactTestRenderer | null = null
  await act(async () => {
    renderer = create(createElement(MobileFileMarkdownPreview, props))
  })
  if (!renderer) {
    throw new Error('MobileFileMarkdownPreview did not render')
  }
  return renderer
}

async function updatePreview(renderer: ReactTestRenderer, props: PreviewProps): Promise<void> {
  await act(async () => {
    renderer.update(createElement(MobileFileMarkdownPreview, props))
  })
}

function modeToggle(renderer: ReactTestRenderer, label: string) {
  const toggle = renderer.root
    .findAllByType('Pressable')
    .find((node) => node.props.accessibilityLabel === label)
  if (!toggle) {
    throw new Error(`Missing ${label} toggle`)
  }
  return toggle
}

async function selectMode(renderer: ReactTestRenderer, label: string): Promise<void> {
  await act(async () => {
    modeToggle(renderer, label).props.onPress()
  })
}

function isSelected(renderer: ReactTestRenderer, label: string): boolean {
  return modeToggle(renderer, label).props.accessibilityState.selected === true
}

describe('MobileFileMarkdownPreview', () => {
  let renderer: ReactTestRenderer | null = null

  afterEach(() => {
    renderer?.unmount()
    renderer = null
    vi.restoreAllMocks()
  })

  it('resets the selected mode for a new file or line target without remounting the preview', async () => {
    const baseProps: PreviewProps = {
      relativePath: 'notes/first.md',
      content: '# First',
      truncated: false,
      byteLength: 7
    }
    renderer = await renderPreview(baseProps)

    expect(isSelected(renderer, 'View rendered Markdown preview')).toBe(true)
    await selectMode(renderer, 'View Markdown source')
    expect(isSelected(renderer, 'View Markdown source')).toBe(true)

    // Content updates alone preserve the user's explicitly selected mode.
    await updatePreview(renderer, { ...baseProps, content: '# First updated' })
    expect(isSelected(renderer, 'View Markdown source')).toBe(true)

    await updatePreview(renderer, { ...baseProps, relativePath: 'notes/second.md' })
    expect(isSelected(renderer, 'View rendered Markdown preview')).toBe(true)

    await updatePreview(renderer, { ...baseProps, relativePath: 'notes/second.md', initialLine: 8 })
    expect(isSelected(renderer, 'View Markdown source')).toBe(true)
  })

  it('shows the text-size control only in preview mode, and opens the picker', async () => {
    const baseProps: PreviewProps = {
      relativePath: 'notes/first.md',
      content: '# First',
      truncated: false,
      byteLength: 7
    }
    renderer = await renderPreview(baseProps)

    const findTextSizeButton = () =>
      renderer!.root
        .findAllByType('Pressable')
        .find((node) => node.props.accessibilityLabel === 'Markdown text size')

    expect(findTextSizeButton()).toBeDefined()
    const picker = renderer.root.find((node) => String(node.type) === 'PickerModal')
    expect(picker.props.visible).toBe(false)

    await act(async () => {
      findTextSizeButton()!.props.onPress()
    })
    expect(renderer.root.find((node) => String(node.type) === 'PickerModal').props.visible).toBe(
      true
    )

    await selectMode(renderer, 'View Markdown source')
    expect(findTextSizeButton()).toBeUndefined()
  })
})
