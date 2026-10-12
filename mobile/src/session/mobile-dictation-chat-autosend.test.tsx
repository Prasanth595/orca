/** Chat auto-send must go through the composer's send path (images + terminal write lock), once. */
import { createElement, useRef } from 'react'
import { act, create } from 'react-test-renderer'
import { describe, expect, it, vi } from 'vitest'

const seen = vi.hoisted(() => {
  const state: { onTranscript: ((text: string) => void) | null; controllerSends: number } = {
    onTranscript: null,
    controllerSends: 0
  }
  return state
})

vi.mock('expo-router', () => ({ useFocusEffect: () => {} }))
vi.mock('../platform/haptics', () => ({ triggerError: () => {} }))
vi.mock('./use-floating-voice-button-settings', () => ({
  useFloatingVoiceButtonSessionSettings: () => ({
    enabled: true,
    sizePercent: 200,
    opacityPercent: 100,
    autoSend: true
  })
}))
vi.mock('../hooks/use-mobile-dictation', () => ({
  useMobileDictation: (opts: { onTranscript: (text: string) => void }) => {
    seen.onTranscript = opts.onTranscript
    return { start: async () => {}, stop: async () => {}, cancel: async () => {} }
  }
}))
vi.mock('./use-mobile-native-chat-send-error', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./use-mobile-native-chat-send-error')>()),
  useMobileNativeChatSendError: () => ({
    message: null,
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
    nativeChatSession: { messages: [] },
    toggleTabChatView: () => {},
    showNativeChat: true,
    showNativeChatRef: { current: true },
    chatComposerText: 'draft',
    setChatComposerText: () => {},
    handleNativeChatSend: async () => {
      seen.controllerSends += 1
      return true
    }
  })
}))
vi.mock('./use-mobile-send-completion-generation', () => ({
  useMobileSendCompletionGeneration: () => () => 0
}))

import { useMobileSessionNativeChatDictation } from './use-mobile-session-native-chat-dictation'

describe('chat dictation auto-send', () => {
  it('calls the composer send path exactly once, not the bare controller send', () => {
    const composerSend = vi.fn(async (_text: string) => true)
    function Probe(): null {
      const scope = {
        hostId: 'h1',
        worktreeId: 'w1',
        client: null,
        connState: 'connected',
        agentSessionHostSupport: { promptCancel: true, questionAnswers: false },
        setInput: () => {},
        liveInputTerminalHandles: new Set<string>(),
        activeHandle: 't1',
        activeSessionTabId: 'tab1',
        activeSessionTab: { id: 'tab1', type: 'agent-session' },
        diffComments: [],
        diffCommentsRef: useRef([]),
        setShowDictationSetup: () => {},
        setDictationMode: () => {},
        deviceTokenRef: useRef('dev'),
        dictationRouteContextRef: useRef(null),
        activeHandleRef: useRef('t1'),
        flushPendingLiveInputBeforeExternalSend: async () => true,
        canSend: true,
        liveInputEnabled: false,
        showToast: () => {},
        resetLiveInputFocus: () => {}
      }
      const model = useMobileSessionNativeChatDictation(
        // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: scope carries every member this hook destructures.
        scope as never,
        async () => true,
        async () => {}
      )
      model.sendNativeChatRef.current = composerSend
      return null
    }
    act(() => {
      create(createElement(Probe))
    })
    act(() => {
      seen.onTranscript?.('hello')
    })
    expect(composerSend).toHaveBeenCalledTimes(1)
    expect(composerSend).toHaveBeenCalledWith('draft hello')
    expect(seen.controllerSends).toBe(0)
  })
})
