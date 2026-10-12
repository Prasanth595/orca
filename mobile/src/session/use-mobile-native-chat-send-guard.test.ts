import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useMobileNativeChatImageAttachments } from './use-mobile-native-chat-image-attachments'

vi.mock('../platform/media-picker', () => ({ useMediaPicker: () => ({ pickImages: vi.fn() }) }))

type HookArgs = Parameters<typeof useMobileNativeChatImageAttachments>[0]
type Hook = ReturnType<typeof useMobileNativeChatImageAttachments>

describe('sendNativeChat in-flight guard', () => {
  let renderer: ReactTestRenderer | null = null
  let hook: Hook | null = null

  function Harness({ args }: { args: HookArgs }): null {
    hook = useMobileNativeChatImageAttachments(args)
    return null
  }

  afterEach(() => {
    act(() => renderer?.unmount())
    renderer = null
    hook = null
  })

  it('rejects an overlapping send without a terminal lock (agent-session tab)', async () => {
    let release: ((outcome: 'accepted') => void) | null = null
    const baseSend = vi.fn().mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = resolve
        })
    )
    baseSend.mockResolvedValue('accepted')
    const args: HookArgs = {
      client: null,
      agent: 'claude',
      activeHandleRef: { current: null },
      deviceTokenRef: { current: null },
      getActiveWorktreeConnectionId: async () => null,
      connState: 'connected',
      scopeKey: 'h\0w\0tab-a',
      enabled: true,
      showToast: vi.fn(),
      onSendError: vi.fn(),
      baseSend,
      readSeededLaunchDraft: () => null,
      sleep: async () => {}
    }
    act(() => {
      renderer = create(createElement(Harness, { args }))
    })
    let first: Promise<boolean> | null = null
    await act(async () => {
      first = hook!.sendNativeChat('auto')
      for (let i = 0; i < 50 && !release; i++) {
        await Promise.resolve()
      }
    })
    let second = true
    await act(async () => {
      second = await hook!.sendNativeChat('tap')
    })
    expect(second).toBe(false)
    expect(baseSend).toHaveBeenCalledTimes(1)
    await act(async () => {
      release!('accepted')
      await first
    })
    let third = false
    await act(async () => {
      third = await hook!.sendNativeChat('next')
    })
    expect(third).toBe(true)
    expect(baseSend).toHaveBeenCalledTimes(2)
  })
})
