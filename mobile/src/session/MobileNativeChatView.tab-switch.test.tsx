import { createElement } from 'react'
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { NativeChatMessage } from '../../../src/shared/native-chat-types'
import { MobileNativeChatView } from './MobileNativeChatView'

const scrollToEnd = vi.hoisted(() => vi.fn())
const scrollToOffset = vi.hoisted(() => vi.fn())
const platform = vi.hoisted(() => ({ OS: 'ios' }))
const nativeMeasurement = vi.hoisted(() => ({ onMount: false }))

vi.mock('react-native', async () => {
  const React = await import('react')
  return {
    ActivityIndicator: 'ActivityIndicator',
    FlatList: React.forwardRef<
      unknown,
      {
        onLayout?: (event: { nativeEvent: { layout: { height: number } } }) => void
        onContentSizeChange?: (width: number, height: number) => void
      }
    >((props, ref) => {
      const mountedProps = React.useRef(props)
      React.useEffect(() => {
        if (nativeMeasurement.onMount) {
          mountedProps.current.onLayout?.({ nativeEvent: { layout: { height: 500 } } })
          mountedProps.current.onContentSizeChange?.(320, 400)
        }
      }, [])
      React.useImperativeHandle(ref, () => ({ scrollToEnd, scrollToOffset }), [])
      return React.createElement('FlatList', props)
    }),
    Platform: platform,
    Pressable: 'Pressable',
    StyleSheet: { create: (styles: unknown) => styles, hairlineWidth: 1 },
    Text: 'Text',
    View: 'View'
  }
})

vi.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 })
}))

vi.mock('react-native-gesture-handler', () => {
  const chain = {
    runOnJS: () => chain,
    onStart: () => chain,
    onUpdate: () => chain
  }
  return {
    Gesture: { Simultaneous: () => ({}), Native: () => ({}), Pinch: () => chain },
    GestureDetector: 'GestureDetector',
    GestureHandlerRootView: 'GestureHandlerRootView'
  }
})

vi.mock('lucide-react-native', () => ({
  ArrowDown: 'ArrowDown',
  ChevronsDownUp: 'ChevronsDownUp',
  ChevronsUpDown: 'ChevronsUpDown',
  Square: 'Square'
}))

vi.mock('./MobileNativeChatMessage', () => ({ MobileNativeChatMessage: 'ChatMessage' }))
vi.mock('./MobileNativeChatLiveLine', () => ({ MobileNativeChatLiveLine: 'LiveStatus' }))
vi.mock('./MobileNativeChatAsk', () => ({ MobileNativeChatAsk: 'ChatAsk' }))
vi.mock('./MobileNativeChatPermission', () => ({ MobileNativeChatPermission: 'ChatPermission' }))
vi.mock('./MobileNativeChatQuestion', () => ({ MobileNativeChatQuestion: 'ChatQuestion' }))
vi.mock('../components/ActionSheetModal', () => ({ ActionSheetModal: 'ActionSheetModal' }))
vi.mock('./MobileAgentWorkingIndicator', () => ({
  MobileAgentWorkingIndicator: 'WorkingIndicator'
}))

vi.mock('./MobileNativeChatComposer', () => ({ MobileNativeChatComposer: 'Composer' }))
let renderer: ReactTestRenderer | undefined
function message(id: string): NativeChatMessage {
  return {
    id,
    role: 'assistant',
    blocks: [{ type: 'text', text: 'Cached chat' }],
    timestamp: 0,
    source: 'hook'
  }
}
function view(scope: string) {
  const rows = [message(scope)]
  return createElement(MobileNativeChatView, {
    messages: rows,
    folded: rows,
    status: 'ready',
    streaming: null,
    pending: [],
    sendSurfaceId: scope,
    getSendCompletionGeneration: () => 0,
    getComposerEditGeneration: () => 0,
    composerText: '',
    onComposerTextChange: () => {},
    onSend: async () => true
  })
}
beforeEach(() => {
  vi.useFakeTimers()
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) =>
    setTimeout(() => callback(0), 16)
  )
  vi.stubGlobal('cancelAnimationFrame', (handle: ReturnType<typeof setTimeout>) =>
    clearTimeout(handle)
  )
})
afterEach(() => {
  act(() => renderer?.unmount())
  renderer = undefined
  nativeMeasurement.onMount = false
  vi.useRealTimers()
  vi.unstubAllGlobals()
})
function list(): ReactTestInstance {
  return renderer!.root.find((node) => String(node.type) === 'FlatList')
}
async function settle() {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(64)
  })
}
it.each(['ios', 'android'])(
  'reveals same-sized cached tabs without another scroll on %s',
  async (os) => {
    platform.OS = os
    nativeMeasurement.onMount = true
    act(() => {
      renderer = create(view('tab-a'))
    })
    await settle()
    expect(list().props.style).toBeUndefined()
    for (const scope of ['tab-b', 'tab-a', 'tab-b']) {
      act(() => renderer!.update(view(scope)))
      await settle()
      expect(list().props.style).toBeUndefined()
      expect(
        renderer!.root.findAll((node) => String(node.type) === 'ActivityIndicator')
      ).toHaveLength(0)
    }
  }
)
it('shows progress while cached rows are being positioned', () => {
  act(() => {
    renderer = create(view('tab-a'))
  })
  expect(list().props.style).toEqual({ opacity: 0 })
  expect(renderer!.root.findAll((node) => String(node.type) === 'ActivityIndicator')).toHaveLength(
    1
  )
  expect(
    renderer!.root.findAll((node) => node.props.accessibilityLabel === 'Restoring conversation…')
      .length
  ).toBeGreaterThan(0)
})
