/**
 * The terminal input mic's hold/toggle binding, read from the host's Settings ▸ Voice at the moments
 * the host's answer can change: a cold route's client connecting for the first time, a reconnect,
 * and the app returning to the foreground.
 *
 * Mounts the real screen state, `useMobileSessionNativeChatDictation` and the mic button, because
 * the stale mode lived in the wiring between them — a focus-only read keyed to a client that
 * survives reconnects — rather than in any one of them.
 */
import { createElement, useEffect, useRef } from 'react'
import { act, create, type ReactTestRenderer, type ReactTestInstance } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { RpcResponse } from '../transport/types'

const env = vi.hoisted(() => ({
  focused: true,
  connected: false,
  mode: 'hold',
  reads: 0,
  foreground: new Set<(state: string) => void>(),
  slowReply: null as null | Promise<RpcResponse>
}))

vi.mock('expo-router', () => ({
  useFocusEffect: (effect: () => void | (() => void)) => {
    useEffect(() => (env.focused ? effect() : undefined), [effect, env.focused])
  }
}))
vi.mock('react-native', () => ({
  Animated: { Value: class {} },
  ActivityIndicator: 'ActivityIndicator',
  Pressable: 'Pressable',
  AppState: {
    currentState: 'active',
    addEventListener: (_event: string, listener: (state: string) => void) => {
      env.foreground.add(listener)
      return { remove: () => env.foreground.delete(listener) }
    }
  }
}))
vi.mock('lucide-react-native', () => ({ ImagePlus: 'ImagePlus', Mic: 'Mic' }))
vi.mock('@react-native-async-storage/async-storage', () => ({ default: {} }))
vi.mock('../platform/haptics', () => ({ triggerError: () => {} }))
vi.mock('./use-terminal-live-input-mode-preference', () => ({
  useTerminalLiveInputModePreference: () => ({ liveInputTerminalHandles: new Set<string>() })
}))
// The capture pipeline and the native-chat surface are off this path; the real modules would pull
// the Expo audio runtime in behind them.
vi.mock('../hooks/use-mobile-dictation', () => ({
  useMobileDictation: () => ({
    isStarting: false,
    isRecording: false,
    isProcessing: false,
    start: async () => {},
    stop: async () => {},
    cancel: async () => {}
  })
}))
vi.mock('./use-mobile-native-chat-send-error', () => ({
  useMobileNativeChatSendError: () => ({
    show: () => {},
    clear: () => {},
    keepWhile: () => {},
    bannerMountedRef: { current: false }
  })
}))
vi.mock('./use-mobile-native-chat-readability', () => ({
  useMobileNativeChatReadability: () => false
}))
vi.mock('./use-mobile-native-chat-input-lease', () => ({
  useMobileNativeChatInputLease: () => ({
    ready: true,
    readyRef: { current: true },
    lockReason: null,
    markReady: () => {},
    clear: () => {}
  })
}))
vi.mock('./use-mobile-native-chat-controller', () => ({
  useMobileNativeChatController: () => ({
    toggleTabChatView: () => {},
    showNativeChat: false,
    showNativeChatRef: { current: false },
    setChatComposerText: () => {}
  })
}))
vi.mock('./use-mobile-send-completion-generation', () => ({
  useMobileSendCompletionGeneration: () => () => 0
}))

import { useMobileSessionScreenState } from './use-mobile-session-screen-state'
import { useMobileSessionNativeChatDictation } from './use-mobile-session-native-chat-dictation'
import { MobileTerminalInputActions } from './MobileTerminalInputActions'

// Mocked react-native components are string tags that ReactTestInstance's ElementType omits.
function hostType(node: ReactTestInstance): unknown {
  return node.type
}

function setupReply(mode: string): RpcResponse {
  return { id: 'desktop', ok: true, result: { enabled: true, dictationMode: mode, models: [] } }
}

// One logical client for the route's lifetime, like the shared per-host client: its identity does
// not change across a reconnect. While down it refuses sends the way a relay session does.
const client = {
  getState: () => (env.connected ? 'connected' : 'reconnecting'),
  sendRequest: async (): Promise<RpcResponse> => {
    env.reads += 1
    if (!env.connected) {
      throw new Error('relay session not connected')
    }
    return env.slowReply ?? setupReply(env.mode)
  }
}

let renderer: ReactTestRenderer | null = null

function Probe() {
  const screen = useMobileSessionScreenState({
    hostId: 'host',
    worktreeId: 'worktree',
    initialCreateWarning: ''
  } as never)
  const activeHandleRef = useRef('terminal')
  const dictationRouteContextRef = useRef(null)
  const deviceTokenRef = useRef('device')
  const scope = {
    ...screen,
    hostId: 'host',
    worktreeId: 'worktree',
    client,
    connState: env.connected ? 'connected' : 'reconnecting',
    activeHandle: 'terminal',
    activeSessionTabId: 'tab',
    activeSessionTab: null,
    activeHandleRef,
    dictationRouteContextRef,
    deviceTokenRef,
    flushPendingLiveInputBeforeExternalSend: async () => true,
    canSend: env.connected,
    liveInputEnabled: false,
    showToast: () => {},
    resetLiveInputFocus: () => {}
  }
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the native-chat dependencies are mocked; the real screen state and the mode read are exercised together.
  const voice = useMobileSessionNativeChatDictation(scope as never, async () => true)
  return createElement(MobileTerminalInputActions, {
    canSend: env.connected,
    isAttaching: false,
    dictation: voice.dictation,
    dictationMode: screen.dictationMode,
    buttonStyle: {},
    activeButtonStyle: {},
    disabledButtonStyle: {},
    onAttachImage: () => {},
    onAttachFile: () => {},
    onDictationToggle: voice.handleDictationToggle,
    onDictationPressIn: voice.handleDictationPressIn,
    onDictationPressOut: voice.handleDictationPressOut,
    onDictationCancel: voice.cancelDictation
  })
}

async function render(): Promise<void> {
  await act(async () => {
    if (renderer) {
      renderer.update(createElement(Probe))
    } else {
      renderer = create(createElement(Probe))
    }
  })
}

/** What a press on the mic does: hold binds press-in/out, toggle binds a tap. */
function micBinding(): 'hold' | 'toggle' | 'inert' {
  const mic = renderer?.root.findAll(
    (node) =>
      hostType(node) === 'Pressable' && node.props.accessibilityLabel === 'Start voice dictation'
  )[0]
  if (mic?.props.onPressIn) {
    return 'hold'
  }
  return mic?.props.onPress ? 'toggle' : 'inert'
}

beforeEach(() => {
  env.focused = true
  env.connected = false
  env.mode = 'hold'
  env.reads = 0
  env.foreground.clear()
  env.slowReply = null
})

afterEach(() => {
  act(() => renderer?.unmount())
  renderer = null
})

describe('the mic follows the host dictation mode', () => {
  it('reads it once the client of a cold route connects, not while it is down', async () => {
    await render()
    const readsWhileDown = env.reads
    env.connected = true
    await render()
    expect({ readsWhileDown, binding: micBinding() }).toEqual({
      readsWhileDown: 0,
      binding: 'hold'
    })
  })

  it('reads it again after a reconnect of the same client', async () => {
    env.connected = true
    await render()
    expect(micBinding()).toBe('hold')
    env.connected = false
    await render()
    env.mode = 'toggle'
    env.connected = true
    await render()
    expect(micBinding()).toBe('toggle')
  })

  it('ignores a reply from the connection that dropped', async () => {
    let answerOld: (reply: RpcResponse) => void = () => {}
    env.slowReply = new Promise((resolve) => {
      answerOld = resolve
    })
    env.connected = true
    await render()
    env.connected = false
    await render()
    env.slowReply = null
    env.connected = true
    await render()
    // The host's answer before the drop, arriving after the reconnected client's own.
    await act(async () => answerOld(setupReply('toggle')))
    expect(micBinding()).toBe('hold')
  })

  it('reads it again when the app returns to the foreground, only while focused', async () => {
    env.connected = true
    await render()
    expect(micBinding()).toBe('hold')
    env.mode = 'toggle'
    await act(async () => {
      for (const listener of env.foreground) {
        listener('active')
      }
    })
    expect(micBinding()).toBe('toggle')
    env.focused = false
    await render()
    expect(env.foreground.size).toBe(0)
  })
})
