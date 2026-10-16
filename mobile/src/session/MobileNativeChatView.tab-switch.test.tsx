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
    renderer!.root.findAll((node) => node.props.accessibilityLabel === 'Loading conversation…')
      .length
  ).toBeGreaterThan(0)
})

it('loads older history when a short transcript cannot emit a scroll movement', () => {
  const onLoadEarlier = vi.fn()
  act(() => {
    renderer = create(
      createElement(MobileNativeChatView, {
        ...view('short').props,
        hasMore: true,
        onLoadEarlier
      })
    )
  })
  act(() => {
    list().props.onScrollBeginDrag()
    list().props.onScrollEndDrag({
      nativeEvent: {
        contentOffset: { x: 0, y: 0 },
        contentSize: { width: 320, height: 400 },
        layoutMeasurement: { width: 320, height: 500 },
        contentInset: { top: 0, bottom: 0, left: 0, right: 0 },
        zoomScale: 1
      }
    })
  })
  expect(onLoadEarlier).toHaveBeenCalledOnce()
})

it('labels only visible cached content as updating until the live host answers', async () => {
  nativeMeasurement.onMount = true
  act(() => {
    renderer = create(
      createElement(MobileNativeChatView, { ...view('cached').props, status: 'loading' })
    )
  })
  expect(
    renderer!.root.findAll((node) => node.props.accessibilityLabel === 'Updating conversation…')
  ).toHaveLength(0)
  await settle()
  expect(
    renderer!.root.findAll((node) => node.props.accessibilityLabel === 'Loading conversation…')
  ).toHaveLength(0)
  expect(
    renderer!.root.findAll((node) => node.props.accessibilityLabel === 'Updating conversation…')
      .length
  ).toBeGreaterThan(0)
  act(() => renderer!.update(view('cached')))
  expect(
    renderer!.root.findAll((node) => node.props.accessibilityLabel === 'Updating conversation…')
  ).toHaveLength(0)
})

it('uses only the inline history loader without a floating refresh control', () => {
  const onLoadEarlier = vi.fn()
  act(() => {
    renderer = create(
      createElement(MobileNativeChatView, { ...view('pull').props, hasMore: true, onLoadEarlier })
    )
  })
  expect(list().props.onRefresh).toBeUndefined()
  expect(list().props.refreshing).toBeUndefined()
  act(() => list().props.ListHeaderComponent.props.onPress())
  expect(onLoadEarlier).toHaveBeenCalledOnce()
  act(() => renderer!.update(view('pull')))
  expect(list().props.onRefresh).toBeUndefined()
})
it('does not detach initial positioning when Process is pressed before the cache is visible', () => {
  act(() => {
    renderer = create(view('opening'))
  })
  const toggle = renderer!.root
    .findAll((node) => String(node.type) === 'Pressable')
    .find(
      (node) =>
        node.findAll((child) => String(child.type) === 'Text' && child.props.children === 'Tools')
          .length > 0
    )
  expect(toggle).toBeDefined()
  act(() => toggle!.props.onPress())
  scrollToOffset.mockClear()
  act(() => list().props.onContentSizeChange(320, 1800))
  expect(scrollToOffset).toHaveBeenCalledWith({ animated: false, offset: 1800 })
})

it("opens switched chats at the newest message with each tab's disclosure state", async () => {
  nativeMeasurement.onMount = true
  act(() => {
    renderer = create(view('tab-a'))
  })
  await settle()
  act(() => {
    list().props.onScrollBeginDrag()
    list().props.onScroll({
      nativeEvent: {
        contentOffset: { y: 100 },
        contentSize: { height: 1800 },
        layoutMeasurement: { height: 500 }
      }
    })
  })
  const label = (text: string) => renderer!.root.findAllByProps({ children: text })
  const jumpControls = () =>
    renderer!.root.findAllByProps({ accessibilityLabel: 'Scroll to latest' })
  act(() => label('Tools')[0].parent!.props.onPress())
  expect(jumpControls()).toHaveLength(1)
  act(() => renderer!.update(view('tab-b')))
  await settle()
  expect(jumpControls()).toHaveLength(0)
  expect(label('Tools')).toHaveLength(1)
  act(() => renderer!.update(view('tab-a')))
  await settle()
  expect(label('Collapse')).toHaveLength(1)
  expect(jumpControls()).toHaveLength(0)
})

it('appends the streaming bubble after cached rows', async () => {
  act(() => {
    renderer = create(view('tab-a'))
  })
  expect(list().props.data.map((row: { id: string }) => row.id)).toEqual(['tab-a'])
  act(() =>
    renderer!.update(
      createElement(MobileNativeChatView, {
        ...view('tab-a').props,
        streaming: 'The tests'
      })
    )
  )
  expect(list().props.data.map((row: { id: string }) => row.id)).toEqual(['tab-a', 'streaming'])
})
