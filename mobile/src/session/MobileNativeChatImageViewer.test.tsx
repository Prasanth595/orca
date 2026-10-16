import { useContext } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { expect, it, vi } from 'vitest'
import { MobileNativeChatImageViewerHost } from './MobileNativeChatImageViewer'
import {
  MobileNativeChatImageViewerContext,
  type MobileNativeChatViewedImage
} from './mobile-native-chat-image-viewer-context'

vi.mock('react-native', () => ({
  Image: 'Image',
  Modal: 'Modal',
  Pressable: 'Pressable',
  ScrollView: 'ScrollView',
  View: 'View',
  StyleSheet: { create: (styles: unknown) => styles }
}))
vi.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 })
}))
vi.mock('lucide-react-native', () => ({ X: 'X' }))

let openImage: ((image: MobileNativeChatViewedImage) => void) | null = null
function Row(): null {
  openImage = useContext(MobileNativeChatImageViewerContext)
  return null
}
const chat = (scopeKey: string) => (
  <MobileNativeChatImageViewerHost style={null} scopeKey={scopeKey}>
    <Row />
  </MobileNativeChatImageViewerHost>
)

it("closes a picture when a notification switches the chat under it, and doesn't reopen it", () => {
  let renderer: ReactTestRenderer | null = null
  act(() => {
    renderer = create(chat('chat-a'))
  })
  const viewers = () => renderer!.root.findAll((node) => String(node.type) === 'Modal')
  act(() => openImage!({ uri: 'file:///a.jpg', label: 'a photo' }))
  expect(viewers()).toHaveLength(1)

  act(() => renderer!.update(chat('chat-b')))
  expect(viewers()).toHaveLength(0)
  act(() => renderer!.update(chat('chat-a')))
  expect(viewers()).toHaveLength(0)
  act(() => renderer!.unmount())
})
