import { describe, expect, it, vi } from 'vitest'
import { SESSION_TABS_CHAT_FORK_CLI_RUNTIME_CAPABILITY } from '../../../src/shared/session-tabs-runtime-capabilities'

vi.mock('lucide-react-native', () => ({ SquareTerminal: 'Icon' }))

const { canOfferMobileNativeChatCliFork, getMobileNativeChatCliForkActions } =
  await import('./mobile-native-chat-cli-fork')

describe('phone chat CLI fork action', () => {
  it('requires the complete host contract and sends only the source intent to the existing creator', () => {
    expect(canOfferMobileNativeChatCliFork({
      agent: 'claude', hostCapabilities: [], workspaceOnPairedHost: true
    })).toBe(false)
    expect(canOfferMobileNativeChatCliFork({
      agent: 'claude',
      hostCapabilities: [SESSION_TABS_CHAT_FORK_CLI_RUNTIME_CAPABILITY],
      workspaceOnPairedHost: false
    })).toBe(false)

    const handleCreateTerminal = vi.fn(async () => 'created')
    const onDismiss = vi.fn()
    const actions = getMobileNativeChatCliForkActions({
      controller: {
        client: { sendRequest: vi.fn() },
        hostCapabilities: [SESSION_TABS_CHAT_FORK_CLI_RUNTIME_CAPABILITY],
        handleCreateTerminal
      // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: The action reads only these three controller members.
      } as never,
      tab: { sessionId: 'chat-1', agent: 'claude' },
      workspaceOnPairedHost: true,
      onDismiss
    })
    expect(actions).toHaveLength(1)
    actions[0]?.onPress?.()
    expect(onDismiss).toHaveBeenCalledOnce()
    expect(handleCreateTerminal).toHaveBeenCalledWith(undefined, {
      sourceChatFork: { sessionId: 'chat-1', agent: 'claude' }
    })
  })
})
